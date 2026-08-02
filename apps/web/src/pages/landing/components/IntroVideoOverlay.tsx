import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "../../../components/ui/button.js";

export function IntroVideoOverlay() {
  const [show, setShow] = useState(false);
  const [fading, setFading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Check if the user has seen the intro video before
    const hasSeenIntro = localStorage.getItem("codeapt_has_seen_intro");
    if (!hasSeenIntro) {
      setShow(true);
      // Disable scrolling on the body while the video is playing
      document.body.style.overflow = "hidden";
    }
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = 1.5;
    }
  }, [show, fading]);

  const handleVideoEnd = () => {
    setFading(true);
    setTimeout(() => {
      setShow(false);
      localStorage.setItem("codeapt_has_seen_intro", "true");
      document.body.style.overflow = "";
    }, 800); // Wait for fade out animation
  };

  const handleSkip = () => {
    handleVideoEnd();
  };

  if (!show) return null;

  return (
    <AnimatePresence>
      {show && !fading && (
        <motion.div
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-surface"
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            onEnded={handleVideoEnd}
            className="h-full w-full object-cover"
          >
            {/* USER ACTION REQUIRED: Place the actual MP4 file at apps/web/public/media/intro.mp4 */}
            <source src="/media/intro.mp4" type="video/mp4" />
          </video>
          
          {/* Skip button for convenience */}
          <div className="absolute bottom-8 right-8 z-[101]">
            <Button variant="outline" size="sm" onClick={handleSkip} className="bg-surface/50 backdrop-blur-md">
              Skip intro
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
