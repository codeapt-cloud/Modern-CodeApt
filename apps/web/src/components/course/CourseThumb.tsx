import { useState } from "react";

import { cn } from "../../lib/cn.js";
import { imageUrl } from "../../lib/cloudinary.js";

/**
 * Subject thumbnail. Renders the real image when one is set (migrated Cloudinary
 * public-ids are expanded via `imageUrl`, same as the admin view), and falls
 * back to a branded gradient tile with the subject initial when there is no
 * image — or if the image fails to load.
 */
export function CourseThumb({
  name,
  image,
  className,
}: {
  name: string;
  image?: string | null;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const src = imageUrl(image);

  if (src && !errored) {
    return (
      <img
        src={src}
        alt=""
        className={cn("object-cover", className)}
        onError={() => setErrored(true)}
      />
    );
  }

  const initial = name.trim().charAt(0).toUpperCase() || "{";
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-primary-500/25 via-surface-overlay to-primary-800/10",
        className,
      )}
      aria-hidden="true"
    >
      <span className="absolute left-3 top-2 font-mono text-2xl text-primary/40">
        {"{"}
      </span>
      <span className="font-mono text-4xl font-bold text-primary">
        {initial}
      </span>
      <span className="absolute bottom-2 right-3 font-mono text-2xl text-primary/40">
        {"}"}
      </span>
    </div>
  );
}
