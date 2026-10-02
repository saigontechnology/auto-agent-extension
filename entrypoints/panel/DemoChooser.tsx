import { useEffect, useMemo, useState } from 'react';
import type { Project } from '@/lib/api/auto-agent-client';
import type { JobMatch } from '@/lib/api/job-matcher';
import { sendToBackground } from '@/lib/background-client';
import { Icon } from './icons';

const SERVICE_LABELS: Record<string, string> = {
  FRONTEND_DEMO: 'Frontend demo',
  FRONTEND_DEMO_NEXT_PHASE: 'Frontend demo, next phase',
  MOBILE_DEMO: 'Mobile demo',
  MOBILE_DEMO_NEXT_PHASE: 'Mobile demo, next phase',
};

function describe(demo: JobMatch): string {
  const kind = SERVICE_LABELS[demo.serviceType] ?? demo.serviceType;
  if (!demo.completedAt) return kind;
  const date = new Date(demo.completedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${kind}, finished ${date}`;
}

function siteOf(demo: JobMatch): string | null {
  if (!demo.deploymentUrl) return null;
  try {
    return new URL(demo.deploymentUrl).host;
  } catch {
    return null;
  }
}

/** Name, kind and site of a demo: enough to tell two demos of one project apart. */
function DemoFacts({ demo, project }: { demo: JobMatch; project?: boolean }) {
  const site = siteOf(demo);
  return (
    <span className="choice__body">
      <span className="choice__name">{demo.jobName}</span>
      <span className="choice__meta">{project ? `${demo.projectName}, ${describe(demo)}` : describe(demo)}</span>
      {site && <span className="choice__site">{site}</span>}
    </span>
  );
}

type Props = {
  url: string;
  /** The demo in use before the list was opened; offered as the way back. */
  previous: JobMatch | null;
  error: string | null;
  onChoose: (demo: JobMatch) => void;
  onCancel?: () => void;
};

/** Project, then demo: where this page's feedback will go. */
export function DemoChooser({ url, previous, error, onChoose, onCancel }: Props) {
  // Undefined while Auto Agent is being searched for a demo at this page's site.
  const [suggestion, setSuggestion] = useState<JobMatch | null | undefined>(undefined);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [query, setQuery] = useState('');
  const [project, setProject] = useState<Project | null>(null);
  const [demos, setDemos] = useState<JobMatch[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void sendToBackground({ type: 'suggest-job', url }).then((result) => {
      if (active) setSuggestion(result.ok ? result.value : null);
    });
    void sendToBackground({ type: 'list-projects' }).then((result) => {
      if (!active) return;
      if (result.ok) setProjects(result.value);
      else setLoadError(result.error);
    });
    return () => {
      active = false;
    };
  }, [url]);

  useEffect(() => {
    setDemos(null);
    if (!project) return;
    let active = true;
    void sendToBackground({ type: 'list-demo-jobs', project }).then((result) => {
      if (!active) return;
      if (result.ok) {
        setDemos(result.value);
        setLoadError(null);
      } else {
        setLoadError(result.error);
      }
    });
    return () => {
      active = false;
    };
  }, [project]);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return (projects ?? []).filter((candidate) => candidate.name.toLowerCase().includes(words));
  }, [projects, query]);

  const keep = onCancel && previous && (
    <button type="button" className="chooser__keep" onClick={onCancel}>
      Keep {previous.jobName}
    </button>
  );

  if (project) {
    return (
      <section className="chooser" aria-label="Choose demo">
        <button type="button" className="chooser__back" onClick={() => setProject(null)}>
          <Icon name="back" />
          Projects
        </button>
        <h2 className="chooser__title">{project.name}</h2>
        {loadError && <p className="error">{loadError}</p>}
        {!demos && !loadError && <p className="muted">Loading demos…</p>}
        {demos?.length === 0 && <p className="muted">No finished demos in this project yet.</p>}
        {demos && demos.length > 0 && (
          <ul className="choices" aria-label="Demos">
            {demos.map((demo) => (
              <li key={demo.jobId}>
                <button type="button" className="choice" onClick={() => onChoose(demo)}>
                  <DemoFacts demo={demo} />
                  {demo.jobId === suggestion?.jobId && <span className="chip chip--running">Matches this page</span>}
                  {demo.jobId === previous?.jobId && <span className="chip chip--pending">In use</span>}
                  <Icon name="next" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {keep}
      </section>
    );
  }

  return (
    <section className="chooser" aria-label="Choose demo">
      <h2 className="chooser__title">Choose the demo you're reviewing</h2>
      <p className="muted">Feedback you send from this page goes to that demo.</p>
      {error && <p className="error">{error}</p>}

      {suggestion === undefined && <p className="muted">Looking for the demo deployed at this page…</p>}
      {suggestion && (
        <div className="chooser__suggestion">
          <span className="chip chip--running">Matches this page</span>
          <DemoFacts demo={suggestion} project />
          <button type="button" className="primary" onClick={() => onChoose(suggestion)}>
            Use this demo
          </button>
        </div>
      )}

      <input
        type="search"
        className="chooser__search"
        placeholder="Search projects"
        aria-label="Search projects"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {loadError && <p className="error">{loadError}</p>}
      {!projects && !loadError && <p className="muted">Loading projects…</p>}
      {projects?.length === 0 && <p className="muted">You are not a member of any project in Auto Agent yet.</p>}
      {projects && projects.length > 0 && shown.length === 0 && (
        <p className="muted">No project name contains "{query.trim()}".</p>
      )}
      {shown.length > 0 && (
        <ul className="choices" aria-label="Projects">
          {shown.map((candidate) => (
            <li key={candidate.id}>
              <button type="button" className="choice" onClick={() => setProject(candidate)}>
                <span className="choice__body">
                  <span className="choice__name">{candidate.name}</span>
                </span>
                <Icon name="next" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {keep}
    </section>
  );
}
