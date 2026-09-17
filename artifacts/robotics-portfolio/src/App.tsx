import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, Brackets, ChevronRight, CircleDot, Cpu, Crosshair, ExternalLink, Github, Layers3, Mail, Menu, Radio, X } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, useAuth, useClerk, useUser, SignIn, SignUp } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { getGetCurrentUserQueryKey, useGetCurrentUser } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const githubProfile = 'https://github.com/DanielWLiu07';
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

type Project = {
  id: string;
  name: string;
  index: string;
  category: string;
  stack: string;
  description: string;
  details: string;
  repo: string;
  accent: string;
};

const projects: Project[] = [
  {
    id: 'voxel-engine',
    name: 'voxel-engine',
    index: '01',
    category: 'Graphics / Systems',
    stack: 'C++20 · OpenGL 4.1',
    description: 'A voxel renderer built around the hard parts: chunk boundaries, packed data, and keeping the frame moving.',
    details: 'Cross-chunk greedy meshing, 12-byte packed vertices, and 9-worker off-thread chunk streaming.',
    repo: 'https://github.com/DanielWLiu07/voxel-engine',
    accent: 'grid',
  },
  {
    id: 'basis',
    name: 'basis',
    index: '02',
    category: 'Low-latency / Finance',
    stack: 'C++20 · WebSockets',
    description: 'A real-time cross-venue market-data engine designed to make the path from wire to decision short.',
    details: 'TLS WebSocket feeds, zero-copy parsing, a matching engine, and low-latency benchmarks.',
    repo: 'https://github.com/DanielWLiu07/basis',
    accent: 'pulse',
  },
  {
    id: 'pomme',
    name: 'pomme',
    index: '03',
    category: 'Robotics / Hackathon',
    stack: 'Autonomous systems',
    description: 'An autonomous fruit-picking and sorting robot made for Hack the 6ix 2026.',
    details: 'A physical system where perception, actuation, and the handoff between them have to agree.',
    repo: 'https://github.com/DanielWLiu07/pomme',
    accent: 'orbit',
  },
  {
    id: 'holo-research',
    name: 'holo-research',
    index: '04',
    category: 'Research / Rendering',
    stack: 'Computer-generated holography',
    description: 'A research log for a computer-generated holography engine.',
    details: 'An evolving notebook for experiments where optics, math, and image formation meet.',
    repo: 'https://github.com/DanielWLiu07/holo-research',
    accent: 'rings',
  },
  {
    id: 'blender-to-threejs',
    name: 'blender-to-threejs',
    index: '05',
    category: 'Graphics / WebGPU',
    stack: 'Three.js · WebGPU · TSL',
    description: 'Reproducing Blender renders in the browser, with the shader pipeline left visible.',
    details: 'A study in translating material intent between Blender and a real-time Three.js renderer.',
    repo: 'https://github.com/DanielWLiu07/blender-to-threejs',
    accent: 'cube',
  },
  {
    id: 'lotus',
    name: 'Lotus',
    index: '06',
    category: 'AI / Creative tools',
    stack: 'Multi-agent AI · Video',
    description: 'A multi-agent system that turns books and manga into beat-synced cinematic trailers.',
    details: 'A generative video timeline editor where agents shape the cut, rhythm, and visual arc.',
    repo: 'https://github.com/DanielWLiu07/Lotus',
    accent: 'film',
  },
];

function StatusPill() {
  return (
    <span className="mono inline-flex items-center gap-2 text-[10px] uppercase tracking-[.13em] text-[hsl(var(--muted))]" data-testid="status-available">
      <span className="status-blink h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />
      open to building
    </span>
  );
}

function DossierMark({ accent }: { accent: string }) {
  if (accent === 'pulse') {
    return <svg viewBox="0 0 200 90" className="h-full w-full" aria-hidden="true"><path className="architecture-line" d="M2 53h26l10-31 16 57 14-47 13 28h23l14-32 10 38 12-13h25l12-21 13 21h22" /><path className="architecture-line" d="M2 75h196" opacity=".28" /></svg>;
  }
  if (accent === 'orbit') {
    return <svg viewBox="0 0 200 90" className="h-full w-full" aria-hidden="true"><ellipse className="architecture-line" cx="100" cy="45" rx="67" ry="19" /><ellipse className="architecture-line" cx="100" cy="45" rx="67" ry="19" transform="rotate(60 100 45)" /><ellipse className="architecture-line" cx="100" cy="45" rx="67" ry="19" transform="rotate(-60 100 45)" /><circle className="architecture-node" cx="100" cy="45" r="7" /></svg>;
  }
  if (accent === 'rings') {
    return <svg viewBox="0 0 200 90" className="h-full w-full" aria-hidden="true"><circle className="architecture-line" cx="100" cy="45" r="33" /><circle className="architecture-line" cx="100" cy="45" r="20" /><circle className="architecture-line" cx="100" cy="45" r="7" /><path className="architecture-line" d="M24 45h50M126 45h50M100 2v20M100 68v20" /></svg>;
  }
  if (accent === 'cube') {
    return <svg viewBox="0 0 200 90" className="h-full w-full" aria-hidden="true"><path className="architecture-line" d="m100 9 43 24v39l-43 23-43-23V33zM57 33l43 25 43-25M100 58v37" /><path className="architecture-line" d="m76 20 43 25v38" opacity=".38" /></svg>;
  }
  if (accent === 'film') {
    return <svg viewBox="0 0 200 90" className="h-full w-full" aria-hidden="true"><rect className="architecture-line" x="34" y="20" width="132" height="50" rx="1" /><path className="architecture-line" d="M34 33h132M34 57h132M53 20v50M147 20v50" /><path className="architecture-line" d="m85 33 28 12-28 12z" /></svg>;
  }
  return <svg viewBox="0 0 200 90" className="h-full w-full" aria-hidden="true"><path className="architecture-line" d="M24 69V29h26v40M50 69V16h26v53M76 69V42h26v27M102 69V26h26v43M128 69V9h26v60M154 69V36h22v33" /><path className="architecture-line" d="M14 78h172" opacity=".4" /><circle className="architecture-node" cx="63" cy="27" r="3" /><circle className="architecture-node" cx="141" cy="20" r="3" /></svg>;
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const links = [['01', 'work'], ['02', 'capabilities'], ['03', 'about']] as const;
  return (
    <header className="relative z-20 border-b border-[hsl(var(--border)/.85)]">
      <div className="section-wrap flex h-[76px] items-center justify-between">
        <a href="#top" className="group flex items-center gap-3" data-testid="link-home">
          <span className="grid h-8 w-8 place-items-center border border-[hsl(var(--foreground))] font-mono text-[10px] transition-transform group-hover:rotate-45">DL</span>
          <span className="hidden text-xs font-semibold tracking-[.16em] sm:block">DANIEL LIU / LAB NOTES</span>
          <span className="text-xs font-semibold tracking-[.16em] sm:hidden">DL / 07</span>
        </a>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary navigation">
          {links.map(([number, label]) => (
            <a key={label} href={`#${label}`} className="mono group text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted))] transition-colors hover:text-[hsl(var(--foreground))]" data-testid={`link-nav-${label}`}>
              <span className="mr-2 text-[hsl(var(--accent))]">{number}</span>{label}
              <span className="ml-2 inline-block w-0 border-t border-[hsl(var(--foreground))] align-middle transition-all group-hover:w-3" />
            </a>
          ))}
          <a href={githubProfile} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-2 text-[10px] uppercase tracking-[.12em] text-[hsl(var(--foreground))]" data-testid="link-github-header">
            <Github size={14} strokeWidth={1.5} /> github
          </a>
          <AuthLinks />
        </nav>
        <button className="md:hidden" onClick={() => setMenuOpen((value) => !value)} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} data-testid="button-mobile-menu">
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>
      {menuOpen && (
        <nav className="border-t border-[hsl(var(--border))] px-4 py-5 md:hidden" aria-label="Mobile navigation">
          {links.map(([number, label]) => (
            <a key={label} href={`#${label}`} onClick={() => setMenuOpen(false)} className="mono flex items-center justify-between border-b border-[hsl(var(--border)/.7)] py-3 text-xs uppercase tracking-[.12em]" data-testid={`link-mobile-${label}`}>
              <span><span className="mr-3 text-[hsl(var(--accent))]">{number}</span>{label}</span><ArrowDownRight size={15} />
            </a>
          ))}
          <a href={githubProfile} target="_blank" rel="noreferrer" className="mono flex items-center gap-2 pt-4 text-xs uppercase tracking-[.12em]" data-testid="link-github-mobile"><Github size={15} /> github / danielwliu07</a>
          <div className="pt-4"><AuthLinks /></div>
        </nav>
      )}
    </header>
  );
}

function AuthLinks() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();

  if (!isLoaded) return null;

  if (isSignedIn) {
    return (
      <div className="mono flex items-center gap-3 text-[10px] uppercase tracking-[.1em]">
        <a href={`${basePath}/user-portal`} className="text-[hsl(var(--accent))]" data-testid="link-user-portal">
          {user?.firstName ?? 'operator'}
        </a>
        <button type="button" onClick={() => signOut({ redirectUrl: basePath || '/' })} className="text-[hsl(var(--muted))] transition-colors hover:text-[hsl(var(--foreground))]" data-testid="button-sign-out">
          sign out
        </button>
      </div>
    );
  }

  return (
    <div className="mono flex items-center gap-3 text-[10px] uppercase tracking-[.1em]">
      <a href={`${basePath}/sign-in`} className="text-[hsl(var(--muted))] transition-colors hover:text-[hsl(var(--foreground))]" data-testid="link-sign-in">
        sign in
      </a>
      <a href={`${basePath}/sign-up`} className="text-[hsl(var(--accent))] transition-colors hover:text-[hsl(var(--foreground))]" data-testid="link-sign-up">
        create account
      </a>
    </div>
  );
}

function Hero() {
  return (
    <section id="top" className="section-wrap relative flex min-h-[calc(100dvh-76px)] flex-col justify-between pb-12 pt-16 md:pb-16 md:pt-24">
      <div className="absolute right-0 top-9 hidden items-center gap-3 md:flex">
        <span className="mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted))]">field log 07 / 2026</span><span className="h-2 w-2 border border-[hsl(var(--foreground))]" />
      </div>
      <div className="grid grid-cols-1 gap-12 md:grid-cols-[1fr_240px] md:items-end">
        <div>
          <div className="reveal mb-8 flex items-center gap-3">
            <span className="h-px w-9 bg-[hsl(var(--foreground))]" /><span className="eyebrow">computer science × finance</span>
          </div>
          <h1 className="hero-title reveal reveal-delay-1 max-w-[1000px]">I build<br /><span className="marker">systems</span><br />that move.</h1>
          <p className="reveal reveal-delay-2 mt-8 max-w-[470px] text-base leading-relaxed text-[hsl(var(--muted))] md:ml-[10%] md:text-lg">
            Daniel Liu is a Computer Science and Finance student at the University of Waterloo. Fast software, visual worlds, and machines that do something real.
          </p>
        </div>
        <div className="reveal reveal-delay-3 calibration relative border border-[hsl(var(--border))] p-5 md:mb-3">
          <div className="mono mb-8 flex items-center justify-between text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted))]"><span>system readout</span><Activity size={13} /></div>
          <div className="space-y-4 mono text-[10px] uppercase tracking-[.08em]">
            <div className="flex justify-between"><span className="text-[hsl(var(--muted))]">signal</span><span>stable</span></div>
            <div className="flex justify-between"><span className="text-[hsl(var(--muted))]">focus</span><span>systems / gfx</span></div>
            <div className="flex justify-between"><span className="text-[hsl(var(--muted))]">location</span><span>waterloo, ca</span></div>
            <div className="flex justify-between"><span className="text-[hsl(var(--muted))]">mode</span><span className="text-[hsl(var(--accent))]">shipping</span></div>
          </div>
          <div className="mt-7 signal-line" />
          <div className="mono mt-2 flex justify-between text-[9px] text-[hsl(var(--muted))]"><span>44.5192° N</span><span>80.2270° W</span></div>
        </div>
      </div>
      <div className="reveal reveal-delay-4 mt-20 flex items-end justify-between border-t border-[hsl(var(--border))] pt-4">
        <div className="mono flex items-center gap-3 text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted))]"><span className="status-blink h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />scroll to inspect</div>
        <a href="#work" className="group flex items-center gap-3 text-xs font-medium uppercase tracking-[.12em]" data-testid="link-explore-work"><span className="hidden sm:block">selected work</span><span className="grid h-10 w-10 place-items-center rounded-full border border-[hsl(var(--foreground))] transition-colors group-hover:bg-[hsl(var(--foreground))] group-hover:text-[hsl(var(--background))]"><ArrowDownRight size={16} /></span></a>
      </div>
    </section>
  );
}

function ScrollReveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.12 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`scroll-reveal ${visible ? 'is-visible' : ''} ${className}`}>{children}</div>;
}

function Work() {
  const [activeId, setActiveId] = useState('voxel-engine');
  const active = projects.find((project) => project.id === activeId) ?? projects[0];
  return (
    <section id="work" className="border-t border-[hsl(var(--border))] py-24 md:py-32">
      <ScrollReveal><div className="section-wrap">
        <div className="mb-14 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div><div className="eyebrow mb-5">01 / selected work</div><h2 className="section-title">Built close<br />to the metal.</h2></div>
          <p className="max-w-[300px] text-sm leading-relaxed text-[hsl(var(--muted))]">A small archive of experiments where performance, rendering, and physical feedback are not afterthoughts.</p>
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_330px]">
          <div className="space-y-2">
            {projects.map((project) => (
              <button key={project.id} type="button" onClick={() => setActiveId(project.id)} className={`project-card group grid w-full grid-cols-[40px_1fr_auto] items-center gap-3 border-b border-[hsl(var(--border))] px-2 py-5 text-left md:grid-cols-[60px_1fr_180px_40px] md:gap-5 ${activeId === project.id ? 'bg-[hsl(var(--card))]' : ''}`} data-testid={`button-project-${project.id}`}>
                <span className="mono text-[10px] text-[hsl(var(--accent))]">{project.index}</span>
                <span><span className="block text-base font-semibold tracking-[-.02em] md:text-lg">{project.name}</span><span className="mono mt-1 block text-[9px] uppercase tracking-[.1em] text-[hsl(var(--muted))]">{project.category}</span></span>
                <span className="mono hidden text-[10px] text-[hsl(var(--muted))] md:block">{project.stack}</span>
                <ArrowUpRight size={17} className="project-arrow justify-self-end text-[hsl(var(--muted))]" />
              </button>
            ))}
          </div>
          <aside className="calibration relative min-h-[310px] overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--card)/.45)] p-6" data-testid={`panel-project-${active.id}`}>
            <div className="flex items-center justify-between"><span className="eyebrow">active dossier</span><CircleDot className="text-[hsl(var(--accent))]" size={14} /></div>
            <div className="float-mark mt-8 h-[92px] border-y border-[hsl(var(--border)/.7)] py-1"><DossierMark accent={active.accent} /></div>
            <div className="mt-6"><h3 className="text-2xl font-semibold tracking-[-.04em]">{active.name}</h3><p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted))]">{active.details}</p></div>
            <a href={active.repo} target="_blank" rel="noreferrer" className="mono mt-7 inline-flex items-center gap-2 border-b border-[hsl(var(--foreground))] pb-1 text-[10px] uppercase tracking-[.1em] transition-colors hover:text-[hsl(var(--accent))]" data-testid={`link-repository-${active.id}`}>inspect repository <ExternalLink size={12} /></a>
          </aside>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-8 border-t border-[hsl(var(--border))] pt-6 md:grid-cols-3">
          <div className="eyebrow">archive / 2026</div><p className="max-w-[450px] text-sm leading-relaxed text-[hsl(var(--muted))]">{active.description}</p><a href={active.repo} target="_blank" rel="noreferrer" className="group mono inline-flex items-center gap-2 text-[10px] uppercase tracking-[.1em] md:justify-self-end" data-testid={`link-open-${active.id}`}>open on github <ArrowUpRight className="transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" size={14} /></a>
        </div>
      </div></ScrollReveal>
    </section>
  );
}

function Capabilities() {
  const capabilityRows = [
    { icon: Cpu, title: 'systems', copy: 'C++20, concurrency, memory layout, low-latency data paths', tags: ['C++20', 'multithreading', 'benchmarks'] },
    { icon: Layers3, title: 'graphics', copy: 'Real-time rendering, shaders, geometry, and visual debugging', tags: ['OpenGL 4.1', 'WebGPU', 'Three.js'] },
    { icon: Radio, title: 'machines', copy: 'Autonomy and interfaces where software has to survive contact', tags: ['robotics', 'sensing', 'actuation'] },
    { icon: Brackets, title: 'applied ai', copy: 'Multi-agent systems that turn a creative brief into an editable artifact', tags: ['multi-agent', 'generative video', 'pipelines'] },
  ];
  return (
    <section id="capabilities" className="bg-[hsl(var(--foreground))] py-24 text-[hsl(var(--background))] md:py-32">
      <ScrollReveal><div className="section-wrap">
        <div className="mb-14 flex flex-col justify-between gap-6 md:flex-row md:items-end"><div><div className="eyebrow mb-5 text-[hsl(var(--background)/.55)]">02 / technical capabilities</div><h2 className="section-title">The useful<br /><span className="text-[hsl(var(--accent))]">constraints.</span></h2></div><p className="max-w-[300px] text-sm leading-relaxed text-[hsl(var(--background)/.6)]">I like the layer where an idea becomes a measurable system. The tools change; the attention to the boundary does not.</p></div>
        <div className="grid grid-cols-1 gap-x-12 md:grid-cols-2">
          {capabilityRows.map(({ icon: Icon, title, copy, tags }, index) => (
            <div key={title} className="group border-t border-[hsl(var(--background)/.24)] py-7" data-testid={`capability-${title}`}>
              <div className="flex items-start justify-between"><div className="flex items-center gap-4"><span className="mono text-[10px] text-[hsl(var(--accent))]">0{index + 1}</span><Icon size={20} strokeWidth={1.2} /></div><ChevronRight size={16} className="transition-transform group-hover:translate-x-1" /></div>
              <h3 className="mt-9 text-2xl font-medium tracking-[-.04em]">{title}</h3><p className="mt-3 max-w-[390px] text-sm leading-relaxed text-[hsl(var(--background)/.6)]">{copy}</p>
              <div className="mt-6 flex flex-wrap gap-2">{tags.map((tag) => <span key={tag} className="mono border border-[hsl(var(--background)/.25)] px-2 py-1 text-[9px] uppercase tracking-[.09em] text-[hsl(var(--background)/.65)]">{tag}</span>)}</div>
            </div>
          ))}
        </div>
        <div className="mt-20 flex items-center gap-5"><span className="mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--background)/.5)]">operating principle</span><div className="h-px flex-1 bg-[hsl(var(--background)/.22)]" /><span className="mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--accent))]">measure twice / ship once</span></div>
      </div></ScrollReveal>
    </section>
  );
}

function About() {
  return (
    <section id="about" className="py-24 md:py-32">
      <ScrollReveal><div className="section-wrap grid grid-cols-1 gap-14 md:grid-cols-[.7fr_1.3fr] md:gap-24">
        <div><div className="eyebrow mb-5">03 / field notes</div><div className="mono text-[10px] uppercase leading-loose tracking-[.1em] text-[hsl(var(--muted))]">profile / DL-07<br />discipline / curious generalist<br />state / in progress</div><div className="mt-12 hidden h-40 w-40 border border-[hsl(var(--foreground))] p-3 md:block"><div className="flex h-full flex-col justify-between border border-[hsl(var(--border))] p-3"><Crosshair size={15} /><span className="mono text-[9px] text-[hsl(var(--muted))]">human<br />in the loop</span><span className="mono self-end text-[9px] text-[hsl(var(--muted))]">07°</span></div></div></div>
        <div><h2 className="section-title max-w-[720px]">Precise enough<br />to <span className="marker">care.</span></h2><div className="mt-10 grid gap-7 text-base leading-relaxed text-[hsl(var(--muted))] md:grid-cols-2"><p>Computer Science and Finance at the University of Waterloo. I’m interested in the seam between abstract systems and visible outcomes: a renderer that feels like a world, a market engine that respects time, a robot that knows what it is holding.</p><p>I learn by making the constraints obvious. That means keeping a research log, drawing the architecture, looking at the benchmark, and leaving room for the next question.</p></div><div className="mt-12 border-t border-[hsl(var(--border))] pt-5"><StatusPill /><span className="ml-5 mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted))]">currently building at the edge of software + reality</span></div></div>
      </div></ScrollReveal>
    </section>
  );
}

function Contact() {
  return (
    <section className="border-t border-[hsl(var(--border))] py-24 md:py-32">
      <ScrollReveal><div className="section-wrap">
        <div className="calibration relative overflow-hidden border border-[hsl(var(--foreground))] p-7 md:p-14">
          <div className="absolute -right-10 -top-12 h-44 w-44 rounded-full border border-[hsl(var(--foreground)/.15)] md:h-64 md:w-64" /><div className="absolute -right-1 -top-1 h-16 w-16 rounded-full border border-[hsl(var(--accent)/.7)]" />
          <div className="relative grid gap-12 md:grid-cols-[1fr_auto] md:items-end"><div><div className="eyebrow mb-6">end of transmission</div><h2 className="section-title max-w-[700px]">Have a hard problem?<br /><span className="marker">Send a signal.</span></h2><p className="mt-7 max-w-[430px] text-sm leading-relaxed text-[hsl(var(--muted))]">The fastest way to find me is through GitHub. Read the work, open an issue, or start a conversation.</p></div><a href={githubProfile} target="_blank" rel="noreferrer" className="solid-button w-full px-5 py-4 md:w-auto" data-testid="link-github-contact"><Github size={16} /> open github profile <ArrowUpRight size={15} /></a></div>
        </div>
        <footer className="flex flex-col justify-between gap-4 pt-7 md:flex-row"><span className="mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted))]">Daniel W Liu / @DanielWLiu07</span><span className="mono inline-flex items-center gap-2 text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted))]"><Mail size={13} /> no pitch deck required</span><span className="mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted))]">© 2026 / lab log</span></footer>
      </div></ScrollReveal>
    </section>
  );
}

function Home() {
  return <main className="lab-page" id="top"><Header /><Hero /><Work /><Capabilities /><About /><Contact /></main>;
}

function AuthLoading() {
  return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))]"><span className="mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted))]">initializing session</span></div>;
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  if (isSignedIn) return <Redirect to="/user-portal" />;
  return <Home />;
}

function UserPortal() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const currentUser = useGetCurrentUser({
    query: {
      enabled: isLoaded && isSignedIn === true,
      queryKey: getGetCurrentUserQueryKey(),
    },
  });

  if (!isLoaded) return <AuthLoading />;
  if (!isSignedIn) return <Redirect to="/" />;

  return (
    <main className="lab-page min-h-[100dvh]">
      <header className="border-b border-[hsl(var(--border)/.85)]">
        <div className="section-wrap flex h-[76px] items-center justify-between">
          <a href={`${basePath}/`} className="group flex items-center gap-3" data-testid="link-portal-home">
            <span className="grid h-8 w-8 place-items-center border border-[hsl(var(--foreground))] font-mono text-[10px] transition-transform group-hover:rotate-45">DL</span>
            <span className="text-xs font-semibold tracking-[.16em]">LAB ACCESS</span>
          </a>
          <button type="button" onClick={() => signOut({ redirectUrl: basePath || '/' })} className="mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted))] transition-colors hover:text-[hsl(var(--foreground))]" data-testid="button-portal-sign-out">
            end session
          </button>
        </div>
      </header>
      <section className="section-wrap py-20 md:py-28">
        <div className="eyebrow mb-5">authenticated operator</div>
        <h1 className="section-title max-w-[800px]">Welcome back,<br /><span className="marker">{user?.firstName ?? 'operator'}.</span></h1>
        <div className="mt-12 grid max-w-[760px] gap-4 md:grid-cols-2">
          <div className="calibration border border-[hsl(var(--border))] p-6">
            <div className="mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted))]">session record</div>
            <div className="mt-7 space-y-4 mono text-[10px] uppercase tracking-[.08em]">
              <div className="flex justify-between gap-5"><span className="text-[hsl(var(--muted))]">identity</span><span className="truncate">{user?.primaryEmailAddress?.emailAddress ?? 'verified account'}</span></div>
              <div className="flex justify-between gap-5"><span className="text-[hsl(var(--muted))]">status</span><span className="text-[hsl(var(--accent))]">authenticated</span></div>
              <div className="flex justify-between gap-5"><span className="text-[hsl(var(--muted))]">record</span><span>{currentUser.data?.id ?? 'syncing'}</span></div>
            </div>
          </div>
          <div className="border border-[hsl(var(--border))] p-6">
            <div className="mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted))]">database link</div>
            <p className="mt-7 text-sm leading-relaxed text-[hsl(var(--muted))]">
              Your account record is persisted and ready for the robotics project workspace.
            </p>
            <div className="mt-6 mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--accent))]">
              {currentUser.isLoading ? 'syncing record' : currentUser.isError ? 'record unavailable' : 'record synchronized'}
            </div>
          </div>
        </div>
        <a href={`${basePath}/`} className="mono mt-12 inline-flex items-center gap-2 border-b border-[hsl(var(--foreground))] pb-1 text-[10px] uppercase tracking-[.1em]" data-testid="link-return-home">
          return to lab notes <ArrowUpRight size={13} />
        </a>
      </section>
    </main>
  );
}

function SignInPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

function SignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={HomeRedirect} /><Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} /><Route path="/user-portal" component={UserPortal} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in environment');
  return <WouterRouter base={basePath}><ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={{ theme: shadcn, cssLayerName: 'clerk', options: { logoPlacement: 'inside', logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` }, variables: { colorPrimary: '#D19A23', colorForeground: '#1C1D22', colorMutedForeground: '#6E7078', colorDanger: '#B42318', colorBackground: '#F5F5F2', colorInput: '#FFFFFF', colorInputForeground: '#1C1D22', colorNeutral: '#D1D1CC', fontFamily: 'DM Mono, monospace', borderRadius: '0px' } }} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}><QueryClientProvider client={queryClient}><TooltipProvider><Router /></TooltipProvider><Toaster /></QueryClientProvider></ClerkProvider></WouterRouter>;
}

export default App;