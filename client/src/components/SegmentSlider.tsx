import { useRef, useCallback } from 'react';

interface Props {
  durationMs: number;
  startTimeMs: number;
  onChange: (startTimeMs: number) => void;
}

function msToTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function SegmentSlider({ durationMs, startTimeMs, onChange }: Props) {
  const barRef = useRef<HTMLDivElement>(null);

  const WINDOW_MS = 30_000;
  const maxStart = Math.max(0, durationMs - WINDOW_MS);

  // Percentage positions for the highlight window
  const windowLeft = (startTimeMs / durationMs) * 100;
  const windowWidth = (WINDOW_MS / durationMs) * 100;

  const positionFromEvent = useCallback(
    (clientX: number): number => {
      const bar = barRef.current;
      if (!bar) return 0;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.min(maxStart, Math.round(ratio * durationMs));
    },
    [durationMs, maxStart],
  );

  // Mouse drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onChange(positionFromEvent(e.clientX));

      const onMove = (mv: MouseEvent) => onChange(positionFromEvent(mv.clientX));
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [onChange, positionFromEvent],
  );

  // Touch drag
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      onChange(positionFromEvent(touch.clientX));

      const onMove = (tv: TouchEvent) => onChange(positionFromEvent(tv.touches[0].clientX));
      const onEnd = () => {
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
      };
      window.addEventListener('touchmove', onMove);
      window.addEventListener('touchend', onEnd);
    },
    [onChange, positionFromEvent],
  );

  return (
    <div className="space-y-3 select-none">
      {/* Track duration labels */}
      <div className="flex justify-between text-xs text-gray-500">
        <span>0:00</span>
        <span className="text-brand-400 font-semibold">
          Drag to choose a 30-second clip
        </span>
        <span>{msToTime(durationMs)}</span>
      </div>

      {/* Slider bar */}
      <div
        ref={barRef}
        className="relative h-10 bg-gray-700 rounded-full cursor-pointer overflow-hidden"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        role="slider"
        aria-label="Segment start position"
        aria-valuemin={0}
        aria-valuemax={maxStart}
        aria-valuenow={startTimeMs}
      >
        {/* Background texture layer */}
        <div className="absolute inset-0 bg-gray-600 opacity-30 rounded-full" />

        {/* Selected 30-second window */}
        <div
          className="absolute top-0 h-full bg-brand-600 opacity-80 rounded-full transition-none"
          style={{ left: `${windowLeft}%`, width: `${windowWidth}%` }}
        />

        {/* Left handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-8 bg-white rounded-full shadow-lg cursor-grab active:cursor-grabbing"
          style={{ left: `calc(${windowLeft}% - 8px)` }}
        />

        {/* Right edge marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-1 h-6 bg-brand-300 rounded-full opacity-70"
          style={{ left: `calc(${windowLeft + windowWidth}% - 2px)` }}
        />
      </div>

      {/* Time readout */}
      <div className="flex justify-between text-sm font-mono">
        <span className="text-brand-400 font-semibold">Start {msToTime(startTimeMs)}</span>
        <span className="text-gray-400">to</span>
        <span className="text-brand-400 font-semibold">End {msToTime(startTimeMs + WINDOW_MS)}</span>
      </div>
    </div>
  );
}
