/**
 * FUMOCA AI Assistance Stubs (Phase G)
 * Interfaces only. No model calls. Manual override always available.
 * Detection is not reconstructed animation.
 */
const FumocaAIAssist = (() => {
  const status = { available: false, reason: 'No AI model configured' };

  function isAvailable() { return status.available; }

  async function suggestPoses(skeletonId, context = {}) {
    console.info('[AIAssist] suggestPoses not available', skeletonId, context);
    return { poses: [], source: 'stub' };
  }

  async function extractMotionFromVideo(videoEl, options = {}) {
    console.info('[AIAssist] extractMotionFromVideo not available');
    return { clips: [], source: 'stub', warning: 'Manual annotation required' };
  }

  async function retarget(sourceSkeletonId, targetSkeletonId) {
    console.info('[AIAssist] retarget not available');
    return { success: false, reason: 'No retargeting model' };
  }

  function setAvailable(flag, reason) {
    status.available = !!flag;
    status.reason = reason || '';
  }

  return {
    isAvailable, suggestPoses, extractMotionFromVideo, retarget, setAvailable,
    getStatus: () => ({ ...status }),
  };
})();

window.FumocaAIAssist = FumocaAIAssist;
export default FumocaAIAssist;
