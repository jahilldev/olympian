# Multi-App GitHub Webhook Architecture

## Overview

This document describes how to support **multiple GitHub Apps** pointing at a **single Olympian instance**, with automatic installation detection and zero-touch onboarding.

### Use Case

You run your own Olympian instance and create multiple GitHub Apps:

- One app per organization you manage
- One app for personal repos, another for work
- Separate apps for different customers/projects

All apps send webhooks to the same endpoint: `https://your-olympian.com/webhooks/github`

### Goals

1. **Single webhook endpoint** - all apps use the same URL
2. **Automatic app discovery** - first webhook from a new installation auto-detects which app owns it
3. **Filesystem-based app registration** - drop a YAML config file + PEM key, restart (or hot-reload)
4. **Secure key storage** - PEM keys encrypted at rest in the database
5. **No manual installation registration** - installs detected via webhook
6. **Correct signature verification** - each webhook verified with the right app's secret

## Architecture

### High-Level Flow

```
GitHub App "Acme"          GitHub App "XYZ"          GitHub App "Personal"
   appId: 111111              appId: 222222             appId: 333333
   webhook: /webhooks/github  webhook: /webhooks/github webhook: /webhooks/github
        ↓                          ↓                         ↓
        └──────────────────────────┴─────────────────────────┘
                                   ↓
                    Single Olympian Instance
                      /webhooks/github endpoint
                                   ↓
                    1. Extract installation ID from payload
                    2. Look up which app owns this installation
                    3. Verify signature with that app's webhook secret
                    4. Process webhook
```

### Key Insight

Every GitHub webhook includes `installation.id` in the payload. This is the **foreign key** that maps an installation to its parent app.

```json
{
  "action": "labeled",
  "installation": {
    "id": 12345678  ← Use this to find which app
  },
  "issue": { ... },
  "repository": { ... }
}
```

## Database Schema Changes

### New Table: `GithubApp`

Tracks each GitHub App registered with your instance:

```prisma
model GithubApp {
  id              String   @id @default(cuid())
  appId           String   @unique // GitHub's numeric app ID
  name            String   // Human-readable: "Acme Corp App", "Personal"
  webhookSecret   String   // Webhook secret for signature verification
  privateKeyEnc   String?  // Encrypted PEM private key
  privateKeyPath  String?  // Alternative: filesystem path to .pem file
  slug            String   @unique // URL-safe identifier for CLI/API
  active          Boolean  @default(true)
  metadata        String?  // JSON: contact info, notes, etc.
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  installations   RepoInstallation[]
}
```

### Modified Table: `RepoInstallation`

Add foreign key to `GithubApp`:

```prisma
model RepoInstallation {
  id             String    @id @default(cuid())
  app            GithubApp @relation(fields: [appId], references: [id])
  appId          String    // ← NEW: FK to GithubApp
  installationId BigInt    @unique
  accountLogin   String
  accountType    String
  triggerLabel   String?
  suspended      Boolean   @default(false)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  jobs           Job[]

  @@index([appId])
}
```

### Migration Notes

- Existing installations must be backfilled to point to a "primary" app
- See "Migration Path" section below

## App Registration (Filesystem Auto-Sync)

### Config File Format

```yaml
# /var/lib/olympian/apps/acme.yaml
name: Acme Corp App
appId: "123456"
slug: acme
webhookSecret: whsec_abc123...
privateKeyPath: ./acme.pem # Relative to this file
active: true
metadata:
  contact: admin@acme.com
  notes: "Customer-facing app for Acme repos"
```

### Directory Structure

```
/var/lib/olympian/apps/
  ├── acme.yaml
  ├── acme.pem
  ├── xyz.yaml
  ├── xyz.pem
  ├── personal.yaml
  └── personal.pem
```

### Environment Variables

```bash
# .env
GITHUB_APPS_CONFIG_DIR=/var/lib/olympian/apps
ENCRYPTION_SECRET=your-32-char-secret-key-here
```

## Implementation

### 1. Encryption Utility

Create `api/src/config/encryption.utility.ts`:

```typescript
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const SALT_LENGTH = 16;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LENGTH);
}

export function encryptValue(plaintext: string, masterSecret: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(masterSecret, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  // Format: salt + iv + tag + ciphertext (all base64)
  const combined = Buffer.concat([salt, iv, tag, encrypted]);
  return combined.toString("base64");
}

export function decryptValue(ciphertext: string, masterSecret: string): string {
  const combined = Buffer.from(ciphertext, "base64");

  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = combined.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + TAG_LENGTH,
  );
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(masterSecret, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(encrypted) + decipher.final("utf8");
}
```

### 2. Enhanced Config Model

Update `api/src/config/config.model.ts`:

```typescript
export const envSchema = z.object({
  // ... existing fields ...

  // Multi-app support
  GITHUB_APPS_CONFIG_DIR: z.string().optional(),
  ENCRYPTION_SECRET: z.string().min(32).optional(),
});
```

### 3. App Sync Service

Modify `api/src/github/github.service.ts` to load apps on startup:

```typescript
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppConfigService } from "../config/config.service.js";
import { encryptValue, decryptValue } from "../config/encryption.utility.js";
import type { RepoRef } from "./github.model.js";

interface AppConfig {
  name: string;
  appId: string;
  slug: string;
  webhookSecret: string;
  privateKeyPath: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class GithubService implements OnModuleInit {
  private readonly logger = new Logger(GithubService.name);
  private readonly installationClients = new Map<number, Octokit>();
  private readonly appCredentials = new Map<
    string,
    { appId: string; privateKey: string }
  >();

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.syncAppsFromFilesystem();
  }

  /** Load all app configs from GITHUB_APPS_CONFIG_DIR on startup */
  private async syncAppsFromFilesystem(): Promise<void> {
    const appsDir = this.config.get("GITHUB_APPS_CONFIG_DIR");
    if (!appsDir) {
      this.logger.log(
        "No GITHUB_APPS_CONFIG_DIR configured, using single-app mode",
      );
      return;
    }

    this.logger.log(`Syncing GitHub Apps from ${appsDir}`);

    try {
      const files = await readdir(appsDir);
      const yamlFiles = files.filter(
        (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
      );

      for (const file of yamlFiles) {
        try {
          await this.loadAppConfig(join(appsDir, file));
        } catch (err) {
          this.logger.error(
            `Failed to load ${file}: ${(err as Error).message}`,
          );
        }
      }

      this.logger.log(`✓ Synced ${yamlFiles.length} GitHub Apps`);
    } catch (err) {
      this.logger.warn(`Apps directory not accessible: ${appsDir}`);
    }
  }

  private async loadAppConfig(configPath: string): Promise<void> {
    const content = await readFile(configPath, "utf8");
    const config: AppConfig = parseYaml(content);

    // Load PEM file (relative to config file)
    const pemPath = join(dirname(configPath), config.privateKeyPath);
    const pemContent = await readFile(pemPath, "utf8");

    const encryptionSecret = this.config.get("ENCRYPTION_SECRET");
    if (!encryptionSecret) {
      throw new Error("ENCRYPTION_SECRET not configured");
    }

    const encryptedPem = encryptValue(pemContent, encryptionSecret);

    // Upsert to database
    await this.prisma.githubApp.upsert({
      where: { slug: config.slug },
      create: {
        name: config.name,
        appId: config.appId,
        slug: config.slug,
        webhookSecret: config.webhookSecret,
        privateKeyEnc: encryptedPem,
        active: config.active ?? true,
        metadata: config.metadata ? JSON.stringify(config.metadata) : null,
      },
      update: {
        name: config.name,
        appId: config.appId,
        webhookSecret: config.webhookSecret,
        privateKeyEnc: encryptedPem,
        active: config.active ?? true,
        metadata: config.metadata ? JSON.stringify(config.metadata) : null,
      },
    });

    this.logger.log(`  ✓ ${config.name} (app ${config.appId})`);
  }

  /** Load and decrypt app credentials from database (with caching) */
  private async getAppAuth(
    appDbId: string,
  ): Promise<{ appId: string; privateKey: string }> {
    const cached = this.appCredentials.get(appDbId);
    if (cached) {
      return cached;
    }

    const app = await this.prisma.githubApp.findUnique({
      where: { id: appDbId },
    });

    if (!app || !app.active) {
      throw new Error(`GitHub app ${appDbId} not found or inactive`);
    }

    if (!app.privateKeyEnc) {
      throw new Error(`No private key configured for app ${app.name}`);
    }

    const encryptionSecret = this.config.get("ENCRYPTION_SECRET");
    if (!encryptionSecret) {
      throw new Error("ENCRYPTION_SECRET not configured");
    }

    const privateKey = decryptValue(app.privateKeyEnc, encryptionSecret);

    const auth = { appId: app.appId, privateKey };
    this.appCredentials.set(appDbId, auth);
    return auth;
  }

  /** Get Octokit for an installation (looks up the app automatically) */
  async installationOctokit(installationId: number): Promise<Octokit> {
    const cached = this.installationClients.get(installationId);
    if (cached) {
      return cached;
    }

    const installation = await this.prisma.repoInstallation.findUnique({
      where: { installationId },
      include: { app: true },
    });

    if (!installation) {
      throw new Error(`Installation ${installationId} not registered`);
    }

    const auth = await this.getAppAuth(installation.appId);

    const client = new Octokit({
      authStrategy: createAppAuth,
      auth: { ...auth, installationId },
    });

    this.installationClients.set(installationId, client);
    return client;
  }

  /**
   * Discover which registered app owns an installation by trying each app's
   * credentials. Used for first-time installation webhooks.
   */
  async discoverAppForInstallation(installationId: number): Promise<GithubApp> {
    const apps = await this.prisma.githubApp.findMany({
      where: { active: true },
    });

    for (const app of apps) {
      try {
        const auth = await this.getAppAuth(app.id);
        const authClient = createAppAuth({
          appId: auth.appId,
          privateKey: auth.privateKey,
        });

        // Try to fetch an installation token
        await authClient({ type: "installation", installationId });

        // Success! This app owns this installation
        this.logger.log(
          `Discovered: installation ${installationId} belongs to app "${app.name}"`,
        );
        return app;
      } catch {
        // This app doesn't own this installation, try next
        continue;
      }
    }

    throw new Error(
      `Installation ${installationId} doesn't match any registered GitHub App. ` +
        `Ensure the app is added to ${this.config.get("GITHUB_APPS_CONFIG_DIR")} first.`,
    );
  }

  /** Evict cached credentials (call when an app is updated) */
  evictApp(appDbId: string): void {
    this.appCredentials.delete(appDbId);
    // Also clear installation clients for this app
    this.installationClients.clear();
  }

  async getInstallationToken(installationId: number): Promise<string> {
    const installation = await this.prisma.repoInstallation.findUnique({
      where: { installationId },
      include: { app: true },
    });

    if (!installation) {
      throw new Error(`Installation ${installationId} not found`);
    }

    const auth = await this.getAppAuth(installation.appId);
    const authClient = createAppAuth({
      appId: auth.appId,
      privateKey: auth.privateKey,
    });

    const result = await authClient({ type: "installation", installationId });
    return result.token;
  }

  evict(installationId: number): void {
    this.installationClients.delete(installationId);
  }

  private client(ref: RepoRef) {
    return this.installationOctokit(ref.installationId);
  }

  // ... rest of existing methods (createIssueComment, etc.) remain unchanged
}
```

### 4. Update Webhook Controller

Modify `api/src/webhook/webhook.controller.ts` to support multi-app discovery:

```typescript
@Post()
@HttpCode(202)
async receive(
  @Req() req: RawBodyRequest<Request>,
  @Headers(EVENT_HEADER) event: string,
  @Headers(DELIVERY_HEADER) delivery: string,
  @Headers(SIGNATURE_HEADER) signature: string,
): Promise<{ ok: true }> {
  const raw = req.rawBody?.toString('utf8');

  if (!raw) {
    throw new BadRequestException('missing raw body');
  }

  if (!event || !delivery) {
    throw new BadRequestException('missing event or delivery headers');
  }

  const payload = req.body as unknown;
  const installationId = (payload as { installation?: { id: number } }).installation?.id;

  if (!installationId) {
    throw new BadRequestException('missing installation ID in payload');
  }

  // Look up which app owns this installation
  let installation = await this.prisma.repoInstallation.findUnique({
    where: { installationId },
    include: { app: true },
  });

  let app: GithubApp;

  if (installation) {
    // Known installation → use its app
    app = installation.app;
  } else {
    // First-time installation → discover which app owns it
    app = await this.github.discoverAppForInstallation(installationId);

    // Register it for future webhooks (if this is an installation event)
    if (event === 'installation' && (payload as { action: string }).action === 'created') {
      const installPayload = payload as InstallationPayload;
      installation = await this.prisma.repoInstallation.create({
        data: {
          appId: app.id,
          installationId,
          accountLogin: installPayload.installation.account.login,
          accountType: installPayload.installation.account.type,
          suspended: false,
        },
        include: { app: true },
      });

      this.logger.log(
        `Auto-registered installation ${installationId} for app "${app.name}" ` +
          `(${installPayload.installation.account.login})`,
      );
    } else {
      throw new BadRequestException(
        `Installation ${installationId} not registered. Install the GitHub App first.`,
      );
    }
  }

  // Verify webhook signature using the correct app's secret
  const valid = verifySignature(app.webhookSecret, raw, signature);

  if (!valid) {
    throw new UnauthorizedException('invalid signature');
  }

  // Record and dispatch
  const shouldProcess = await this.webhooks.record(event, delivery, raw, payload);

  if (shouldProcess) {
    void this.webhooks.dispatch(event, delivery, payload);
  }

  return { ok: true };
}
```

### 5. Update Webhook Service

Ensure `onInstallation` handler registers new installations:

```typescript
// api/src/webhook/webhook.service.ts

private async onInstallation(p: InstallationPayload): Promise<void> {
  if (!p.installation) {
    return;
  }

  const { installation } = p;

  if (p.action === 'created') {
    // Discovery and registration already handled by webhook.controller
    // Just log for visibility
    this.logger.log(`Processing new installation: ${installation.id}`);
  } else if (p.action === 'deleted') {
    // Mark installation as suspended
    await this.prisma.repoInstallation.update({
      where: { installationId: installation.id },
      data: { suspended: true },
    });

    this.github.evict(installation.id);
    this.logger.log(`Installation ${installation.id} removed`);
  } else if (p.action === 'suspend') {
    await this.prisma.repoInstallation.update({
      where: { installationId: installation.id },
      data: { suspended: true },
    });

    this.github.evict(installation.id);
    this.logger.log(`Installation ${installation.id} suspended`);
  } else if (p.action === 'unsuspend') {
    await this.prisma.repoInstallation.update({
      where: { installationId: installation.id },
      data: { suspended: false },
    });

    this.logger.log(`Installation ${installation.id} unsuspended`);
  }
}
```

### 6. Add YAML Parsing Dependency

```bash
npm install yaml
npm install -D @types/node  # Ensure latest for crypto types
```

## Usage

### Initial Setup

```bash
# 1. Create config directory
mkdir -p /var/lib/olympian/apps

# 2. Generate encryption secret
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 3. Configure environment
cat >> api/.env <<EOF
GITHUB_APPS_CONFIG_DIR=/var/lib/olympian/apps
ENCRYPTION_SECRET=<output-from-step-2>
EOF
```

### Adding a New GitHub App

```bash
# 1. Create GitHub App on github.com
#    - Set webhook URL: https://your-olympian.com/webhooks/github
#    - Generate webhook secret
#    - Download private key (.pem file)

# 2. Create config file
cat > /var/lib/olympian/apps/acme.yaml <<EOF
name: Acme Corp App
appId: "123456"
slug: acme
webhookSecret: whsec_abc123...
privateKeyPath: ./acme.pem
active: true
EOF

# 3. Copy PEM file
cp ~/Downloads/acme-app.private-key.pem /var/lib/olympian/apps/acme.pem

# 4. Restart service
sudo systemctl restart olympian

# 5. Install the app on repos via GitHub UI
# 6. Label an issue → automatic job creation
```

### Verifying Apps Are Loaded

Check logs on startup:

```bash
journalctl -u olympian -f | grep "Syncing GitHub Apps"
```

Expected output:

```
Syncing GitHub Apps from /var/lib/olympian/apps
  ✓ Acme Corp App (app 123456)
  ✓ XYZ Company App (app 789012)
  ✓ Personal App (app 345678)
✓ Synced 3 GitHub Apps
```

## Migration Path

### From Single-App to Multi-App

Create a migration script `api/scripts/migrate-to-multi-app.ts`:

```typescript
import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { encryptValue } from "../src/config/encryption.utility.js";

const prisma = new PrismaClient();

async function main() {
  // 1. Create primary app from existing env vars
  const pemContent = process.env.GITHUB_APP_PRIVATE_KEY_PATH
    ? await readFile(process.env.GITHUB_APP_PRIVATE_KEY_PATH, "utf8")
    : process.env.GITHUB_APP_PRIVATE_KEY!;

  const encryptedPem = encryptValue(pemContent, process.env.ENCRYPTION_SECRET!);

  const primaryApp = await prisma.githubApp.create({
    data: {
      appId: process.env.GITHUB_APP_ID!,
      name: "Primary App",
      slug: "primary",
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
      privateKeyEnc: encryptedPem,
      active: true,
    },
  });

  console.log(`✓ Created primary app: ${primaryApp.id}`);

  // 2. Backfill existing installations
  const count = await prisma.repoInstallation.updateMany({
    where: { appId: null },
    data: { appId: primaryApp.id },
  });

  console.log(`✓ Backfilled ${count.count} installations`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

Run it:

```bash
npx tsx api/scripts/migrate-to-multi-app.ts
```

## Security Considerations

### Encryption at Rest

- PEM keys are encrypted using AES-256-GCM before storage
- Master encryption secret must be 32+ characters
- Auth tags prevent tampering

### Webhook Verification

- Each webhook verified with the correct app's unique secret
- Signature mismatch → webhook rejected
- Prevents cross-app webhook forgery

### Secrets Management

**Development:**

- Filesystem storage with Unix permissions: `chmod 600 *.pem`
- Encryption secret in `.env` (git-ignored)

**Production:**

- Use AWS Secrets Manager, HashiCorp Vault, or similar
- Store only secret references in database
- Rotate keys periodically

### Discovery Safeguards

- Discovery only attempts active apps
- Failed auth attempts logged (detect brute force)
- Rate limit the discovery endpoint if exposed externally

## Testing

### Unit Tests

```typescript
// github.service.spec.ts

describe("GithubService", () => {
  it("should sync apps from filesystem", async () => {
    // Mock fs.readdir, fs.readFile
    // Assert apps created in database
  });

  it("should discover app for new installation", async () => {
    // Mock multiple apps in database
    // Mock Octokit auth calls
    // Assert correct app discovered
  });

  it("should cache credentials", async () => {
    // Assert getAppAuth called once, then cached
  });
});
```

### Integration Tests

```typescript
// webhook.e2e-spec.ts

describe("Webhook multi-app", () => {
  it("should route webhook to correct app", async () => {
    // Create 2 apps in test DB
    // Send webhook with installation ID from app 1
    // Assert signature verified with app 1's secret
  });

  it("should discover and register new installation", async () => {
    // Send installation.created webhook
    // Assert RepoInstallation created with correct appId
  });
});
```

### Manual Testing

```bash
# 1. Create test apps in dev environment
# 2. Install on test repos
# 3. Send test webhook via GitHub UI ("Recent Deliveries" → "Redeliver")
# 4. Check logs for discovery and routing
# 5. Label issue, verify job created with correct installation
```

## Performance Considerations

### Caching Strategy

- **App credentials**: Cached in-memory per `appDbId` (cleared on update)
- **Installation clients**: Cached per `installationId` (cleared on eviction)
- **Installation → App mapping**: Single DB query, then cached

### Discovery Overhead

- Only happens on **first webhook** from a new installation
- Subsequent webhooks: single DB lookup (indexed on `installationId`)
- Worst case: try N apps (where N = number of registered apps)

### Database Indexes

Ensure these indexes exist:

```sql
CREATE INDEX idx_installation_app ON RepoInstallation(appId);
CREATE UNIQUE INDEX idx_installation_id ON RepoInstallation(installationId);
CREATE UNIQUE INDEX idx_app_slug ON GithubApp(slug);
CREATE UNIQUE INDEX idx_app_id ON GithubApp(appId);
```

## Operational Runbook

### Adding an App

1. Create GitHub App, download PEM
2. Add YAML config + PEM to `GITHUB_APPS_CONFIG_DIR`
3. Restart service (or wait for hot-reload if implemented)
4. Install app on repos
5. Verify first webhook logs show discovery

### Removing an App

1. Set `active: false` in YAML config
2. Restart service
3. Webhooks from this app will fail signature verification
4. Optionally delete config files and DB record

### Rotating Keys

1. Generate new private key in GitHub App settings
2. Download new PEM
3. Replace old PEM file in `GITHUB_APPS_CONFIG_DIR`
4. Update YAML config if filename changed
5. Restart service
6. Old key rendered invalid

### Troubleshooting

**Webhook fails with "invalid signature":**

- Check `webhookSecret` matches GitHub App settings
- Verify correct app being used (check logs for discovery)

**"Installation not registered":**

- Ensure app config exists and loaded (check startup logs)
- Manually trigger `installation.created` webhook via GitHub UI

**Discovery fails:**

- Check PEM key is valid and not expired
- Verify `ENCRYPTION_SECRET` hasn't changed (keys won't decrypt)
- Check app has permission to access the installation

## Future Enhancements

### Hot-Reload (File Watcher)

Add to `GithubService.onModuleInit()`:

```typescript
import { watch } from 'node:fs/promises';

private async watchForChanges(): Promise<void> {
  const appsDir = this.config.get('GITHUB_APPS_CONFIG_DIR');
  if (!appsDir) return;

  const watcher = watch(appsDir);
  for await (const event of watcher) {
    if (event.filename?.endsWith('.yaml') || event.filename?.endsWith('.yml')) {
      this.logger.log(`Detected change: ${event.filename}, reloading...`);
      await this.loadAppConfig(join(appsDir, event.filename));
    }
  }
}
```

### Admin UI

Create `/admin/github-apps` endpoint to:

- List registered apps
- View installation count per app
- Upload new app configs
- Rotate secrets/keys

### Metrics

Track per-app metrics:

- Webhook volume per app
- Jobs created per app
- Auth failures per app
- Discovery attempts

## References

- GitHub Apps API: https://docs.github.com/en/apps
- Webhook events: https://docs.github.com/en/webhooks
- Octokit auth strategies: https://github.com/octokit/auth-app.js
- Node crypto module: https://nodejs.org/api/crypto.html
