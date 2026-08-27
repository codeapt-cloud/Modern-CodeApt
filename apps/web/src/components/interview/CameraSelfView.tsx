/**
 * Mirrored camera self-view (Step 34 fix #2, extended Step 35 A). Shows the
 * candidate their own video MIRRORED like every video app (scaleX(-1)), with a
 * clear, permanent indicator that frames are analysed on-device and NEVER
 * recorded or uploaded — and a LIVE signal that detection is actually running
 * (an "In frame" / "No face" pill driven by the detector), so it's never
 * ambiguous whether the camera layer works. The <video> here is also the
 * detector's frame source, so "what you see is what's analysed".
 */
import { ScanFace, ShieldCheck } from "lucide-react";

import type { UseCameraObservation } from "../../lib/use-camera-observation.js";

export function CameraSelfView({
  camera,
  className = "",
}: {
  camera: UseCameraObservation;
  className?: string;
}): JSX.Element | null {
  if (!camera.granted) return null;
  return (
    <div className={`relative overflow-hidden rounded-lg bg-black/80 ${className}`}>
      <video
        ref={camera.attach}
        muted
        playsInline
        // Mirror the self-view (front-camera convention). Never persisted.
        style={{ transform: "scaleX(-1)" }}
        className="h-full w-full object-cover"
      />
      {/* Live detection state — a subtle box tint + a pill, so it's obvious the
          face layer is running and whether a face is currently detected. */}
      {camera.detecting ? (
        <div
          className={`pointer-events-none absolute inset-2 rounded-md border-2 transition-colors ${
            camera.inFrame ? "border-emerald-400/80" : "border-amber-400/70"
          }`}
        />
      ) : null}
      <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
        {camera.detecting ? (
          <>
            <ScanFace className="h-3 w-3" />
            {camera.inFrame ? "In frame" : "No face"}
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live
          </>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/55 px-2 py-1 text-[10px] text-white/90">
        <ShieldCheck className="h-3 w-3 shrink-0" />
        Analysed on your device — never recorded or uploaded
      </div>
    </div>
  );
}
