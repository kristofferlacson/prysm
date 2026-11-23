import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { DEMOS } from '../../features/guide/demos';

/**
 * A topic's demonstration: a recording of the editor doing the task, with a moving pointer, the
 * keys that are pressed, and a caption that follows the action. It plays by itself and loops; it
 * can be paused, stepped from caption to caption, scrubbed, and enlarged to fill the window.
 *
 * The recordings start with the stage being set (pictures loaded, panels opened), so only the part
 * between `start` and `end` is played.
 */
export function GuideDemo({ topic }: { topic: string }) {
  const demo = DEMOS[topic];
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(demo?.start ?? 0);
  const [playing, setPlaying] = useState(true);
  const [large, setLarge] = useState(false);

  // Escape leaves the enlarged view without closing the guide behind it.
  useEffect(() => {
    if (!large) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      setLarge(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [large]);

  if (!demo) return null;
  const length = Math.max(0.1, demo.end - demo.start);
  const stepIndex = Math.max(0, demo.steps.findLastIndex((s) => s.at <= time + 0.05));
  const seek = (to: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.min(demo.end - 0.1, Math.max(demo.start, to));
    setTime(v.currentTime);
  };
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };
  const control = 'flex h-7 w-7 items-center justify-center rounded text-dim hover:bg-hover hover:text-ink';

  return (
    <figure
      data-testid="guide-demo"
      data-step={stepIndex}
      data-playing={playing}
      data-large={large}
      className={large ? 'fixed inset-0 z-[70] m-0 flex flex-col bg-black/95 p-4' : 'mt-6 overflow-hidden rounded-lg border border-line bg-bg'}
    >
      <div className={`flex items-center justify-between py-1 pl-3 pr-1.5 ${large ? '' : 'border-b border-line'}`}>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">
          Demonstration · step {stepIndex + 1} of {demo.steps.length}
        </span>
        <span className="flex items-center">
          <button type="button" aria-label="Previous step of the demonstration" className={control} onClick={() => seek(demo.steps[Math.max(0, stepIndex - (time - demo.steps[stepIndex].at > 1 ? 0 : 1))].at)}>
            <SkipBack size={13} />
          </button>
          <button type="button" aria-label={playing ? 'Pause the demonstration' : 'Play the demonstration'} className={control} onClick={toggle}>
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button type="button" aria-label="Next step of the demonstration" className={control} onClick={() => seek(demo.steps[(stepIndex + 1) % demo.steps.length].at)}>
            <SkipForward size={13} />
          </button>
          <button type="button" aria-label="Play the demonstration from the start" className={control} onClick={() => seek(demo.start)}>
            <RotateCcw size={13} />
          </button>
          <button type="button" aria-label={large ? 'Back to the guide' : 'Enlarge the demonstration'} className={control} onClick={() => setLarge(!large)}>
            {large ? <Minimize2 size={14} /> : <Maximize2 size={13} />}
          </button>
        </span>
      </div>

      <div className={large ? 'flex min-h-0 flex-1 items-center justify-center' : ''}>
        <video
          key={demo.file}
          ref={video}
          src={`/guide/${demo.file}#t=${demo.start}`}
          muted
          playsInline
          autoPlay
          preload="auto"
          aria-label={`Recording of the editor: ${demo.steps.map((s) => s.caption).join(' ')}`}
          className={large ? 'max-h-full max-w-full rounded border border-line' : 'block w-full cursor-pointer'}
          onClick={toggle}
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = demo.start;
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            // Loop the part that is the demonstration.
            if (v.currentTime >= demo.end - 0.05 || v.currentTime < demo.start - 0.3) v.currentTime = demo.start;
            setTime(v.currentTime);
          }}
          onEnded={(e) => {
            e.currentTarget.currentTime = demo.start;
            void e.currentTarget.play().catch(() => {});
          }}
        />
      </div>

      <div
        role="slider"
        aria-label="Position in the demonstration"
        aria-valuemin={0}
        aria-valuemax={Math.round(length)}
        aria-valuenow={Math.round(time - demo.start)}
        tabIndex={0}
        className="relative h-2.5 cursor-pointer bg-raised"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          seek(demo.start + ((e.clientX - box.left) / box.width) * length);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') seek(time + 1);
          if (e.key === 'ArrowLeft') seek(time - 1);
        }}
      >
        <div className="h-full bg-accent/70" style={{ width: `${Math.min(100, Math.max(0, ((time - demo.start) / length) * 100))}%` }} />
        {demo.steps.map((s, i) => (
          <span key={i} className="absolute top-0 h-full w-px bg-bg" style={{ left: `${((s.at - demo.start) / length) * 100}%` }} />
        ))}
      </div>
      <figcaption data-testid="guide-demo-caption" className={`px-3 py-2.5 leading-relaxed text-ink ${large ? 'text-center text-[15px]' : 'min-h-[3.6em] text-[13px]'}`}>
        {demo.steps[stepIndex].caption}
      </figcaption>
    </figure>
  );
}
