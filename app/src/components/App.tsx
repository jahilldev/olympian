import { useState, useEffect } from "preact/hooks";
import JobList from "./JobList.tsx";
import JobDetail from "./JobDetail.tsx";
import RunOutput from "./RunOutput.tsx";

export function navigate(to: string): void {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function matchRoute(path: string): {
  view: string;
  params: Record<string, string>;
} {
  const runMatch = path.match(/^\/jobs\/([^/]+)\/runs\/([^/]+)$/);
  if (runMatch)
    return { view: "run", params: { jobId: runMatch[1], runId: runMatch[2] } };

  const detailMatch = path.match(/^\/jobs\/([^/]+)$/);
  if (detailMatch) return { view: "job", params: { id: detailMatch[1] } };

  return { view: "list", params: {} };
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const handler = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const { view, params } = matchRoute(path);

  if (view === "run")
    return <RunOutput jobId={params.jobId} runId={params.runId} />;
  if (view === "job") return <JobDetail id={params.id} />;
  return <JobList />;
}
