import {
  Blend,
  Image as ImageIcon,
  LayoutTemplate,
  PaintBucket,
  Shapes,
  Sparkles,
  Sun,
  Type,
  Upload,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { useUiStore, type SidebarTab } from '../../stores/uiStore';
import { BackgroundsPanel } from './panels/BackgroundsPanel';
import { EffectsPanel } from './panels/EffectsPanel';
import { ElementsPanel } from './panels/ElementsPanel';
import { GeneratorPanel } from './panels/GeneratorPanel';
import { AiPanel } from './panels/AiPanel';
import { PhotosPanel } from './panels/PlannedPanels';
import { TemplatesPanel } from './panels/TemplatesPanel';
import { TextPanel } from './panels/TextPanel';
import { UploadsPanel } from './panels/UploadsPanel';

const TABS: { id: SidebarTab; label: string; icon: LucideIcon }[] = [
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'elements', label: 'Elements', icon: Shapes },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'uploads', label: 'Uploads', icon: Upload },
  { id: 'photos', label: 'Photos', icon: ImageIcon },
  { id: 'backgrounds', label: 'Backgrounds', icon: PaintBucket },
  { id: 'textures', label: 'Textures', icon: Blend },
  { id: 'overlays', label: 'Overlays', icon: Sun },
  { id: 'effects', label: 'Effects', icon: Sparkles },
  { id: 'ai', label: 'AI tools', icon: WandSparkles },
];

function Panel({ tab }: { tab: SidebarTab }) {
  switch (tab) {
    case 'templates':
      return <TemplatesPanel />;
    case 'elements':
      return <ElementsPanel />;
    case 'text':
      return <TextPanel />;
    case 'uploads':
      return <UploadsPanel />;
    case 'photos':
      return <PhotosPanel />;
    case 'backgrounds':
      return <BackgroundsPanel />;
    case 'textures':
      return <GeneratorPanel key="texture" kind="texture" />;
    case 'overlays':
      return <GeneratorPanel key="overlay" kind="overlay" />;
    case 'effects':
      return <EffectsPanel />;
    case 'ai':
      return <AiPanel />;
  }
}

export function Sidebar() {
  const tab = useUiStore((s) => s.sidebarTab);
  const setTab = useUiStore((s) => s.setSidebarTab);
  return (
    <div className="ui-scale flex shrink-0 border-r border-line bg-panel">
      <nav aria-label="Asset libraries" className="flex w-[76px] flex-col items-stretch gap-1 overflow-y-auto py-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            data-tab={id}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={`mx-1.5 flex flex-col items-center gap-1.5 rounded-md py-2 text-[10px] leading-none transition-colors ${
              tab === id ? 'bg-accent/15 text-accent' : 'text-dim hover:bg-hover hover:text-ink'
            }`}
          >
            <Icon size={17} strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </nav>
      {tab && (
        <div data-testid="sidebar-panel" className="w-[292px] border-l border-line">
          <Panel tab={tab} />
        </div>
      )}
    </div>
  );
}
