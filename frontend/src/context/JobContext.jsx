import { createContext, useContext, useState, useEffect } from 'react';

// jobId = the job currently in progress (same meaning as before — Layout
// and existing pages read this unchanged). queue = files staged but not
// yet started. Sequential by design: only one file is ever "in flight"
// at a time, matching the scoping decision made in the staging screen —
// simpler than true parallel job tracking, and honestly disclosed in the
// UI rather than silently limiting.
const JobContext = createContext(null);

export function JobProvider({ children }) {
  const [jobId, setJobId] = useState(() => sessionStorage.getItem('activeJobId') || null);
  const [queue, setQueue] = useState([]); // array of File objects, not yet uploaded

  useEffect(() => {
    if (jobId) sessionStorage.setItem('activeJobId', jobId);
    else sessionStorage.removeItem('activeJobId');
  }, [jobId]);

  function stageFiles(files) {
    setQueue((q) => [...q, ...files]);
  }

  function removeFromQueue(index) {
    setQueue((q) => q.filter((_, i) => i !== index));
  }

  // Pops the next staged file so the caller can upload it. Reads `queue`
  // directly rather than via a setState updater — mutating a variable
  // inside an updater is impure, and React 19 Strict Mode double-invokes
  // updaters in dev specifically to catch that, which could otherwise
  // silently skip a file. Returns undefined if the queue is empty.
  function takeNextFromQueue() {
    if (queue.length === 0) return undefined;
    const next = queue[0];
    setQueue(queue.slice(1));
    return next;
  }

  return (
    <JobContext.Provider value={{ jobId, setJobId, queue, stageFiles, removeFromQueue, takeNextFromQueue }}>
      {children}
    </JobContext.Provider>
  );
}

export function useJob() {
  return useContext(JobContext);
}