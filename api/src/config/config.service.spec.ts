import type { ConfigService } from '@nestjs/config';
import { AppConfigService } from './config.service.js';
import type { Env } from './config.model.js';

// The constructor bridges CUSTOM_API_KEY → OPENAI_API_KEY (the var Hermes' `custom` provider reads).
// bridgeCustomApiKey reads process.env directly, so a bare mock ConfigService is enough.
const makeService = () =>
  new AppConfigService({ get: () => undefined } as unknown as ConfigService<Env, true>);

describe('AppConfigService custom-key bridge', () => {
  const original = { custom: process.env.CUSTOM_API_KEY, openai: process.env.OPENAI_API_KEY };

  afterEach(() => {
    process.env.CUSTOM_API_KEY = original.custom;
    process.env.OPENAI_API_KEY = original.openai;
    if (original.custom === undefined) {
      delete process.env.CUSTOM_API_KEY;
    }
    if (original.openai === undefined) {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('exposes CUSTOM_API_KEY as OPENAI_API_KEY when the latter is unset', () => {
    process.env.CUSTOM_API_KEY = 'sk-custom';
    delete process.env.OPENAI_API_KEY;

    makeService();

    expect(process.env.OPENAI_API_KEY).toBe('sk-custom');
  });

  it('does not clobber an explicitly set OPENAI_API_KEY', () => {
    process.env.CUSTOM_API_KEY = 'sk-custom';
    process.env.OPENAI_API_KEY = 'sk-real-openai';

    makeService();

    expect(process.env.OPENAI_API_KEY).toBe('sk-real-openai');
  });

  it('leaves OPENAI_API_KEY unset when no CUSTOM_API_KEY is provided', () => {
    delete process.env.CUSTOM_API_KEY;
    delete process.env.OPENAI_API_KEY;

    makeService();

    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });
});
