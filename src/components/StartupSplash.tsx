import { memo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import pulseMarkUrl from '../assets/pulse-mark.svg';
import './StartupSplash.css';

export interface StartupSplashProps {
  show: boolean;
}

const STAGES = ['Restoring session…', 'Warming webviews…', 'Ready'];

function StartupSplash({ show }: StartupSplashProps) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!show) return;
    setStage(0);
    const t1 = setTimeout(() => setStage(1), 700);
    const t2 = setTimeout(() => setStage(2), 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [show]);

  const progress = (stage + 1) / STAGES.length;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="startup-splash fixed inset-0 z-[999] flex flex-col items-center justify-center"
          initial={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.45, ease: 'easeInOut' } }}
        >
          <div className="startup-splash__bloom pointer-events-none absolute inset-0" />
          <div className="relative flex flex-col items-center">
            <img
              src={pulseMarkUrl}
              alt="PULSE"
              className="startup-splash__logo h-24 w-24 object-contain"
              draggable={false}
            />
            <div className="mt-6 text-3xl font-semibold tracking-[0.45em] text-[#EDE6D6] pl-[0.45em]">
              PULSE
            </div>
            <div className="startup-splash__track relative mt-8 h-[2px] w-52 overflow-hidden rounded-full">
              <div
                className="startup-splash__fill absolute inset-0"
                style={{ transform: `scaleX(${progress})` }}
              />
              <div className="startup-splash__shimmer absolute inset-y-0 w-2/5" />
            </div>
            <div className="mt-4 h-5 text-xs font-mono text-[#8a8578]">
              <AnimatePresence mode="wait">
                <motion.span
                  key={stage}
                  className="startup-splash__status block"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {STAGES[stage]}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default memo(StartupSplash);
