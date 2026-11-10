export const SAVE_KEY = 'linan-a-day-v1';
export const STAGES = ['meet', 'collect', 'deliver', 'complete'];
export const PEOPLE = ['lin', 'acheng', 'shen'];

export function initialQuest() {
  return { version: 1, stage: 'meet', started: false, met: [], coins: 0, position: null };
}

export function readQuest(raw) {
  if (!raw) return initialQuest();
  try {
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !STAGES.includes(saved.stage)) return initialQuest();
    const position = saved.position;
    const safePosition = position && ['x', 'z', 'yaw'].every(key => Number.isFinite(position[key])) && Math.abs(position.x) < 8000 && Math.abs(position.z) < 8000;
    return {
      version: 1, stage: saved.stage, started: saved.started === true,
      met: Array.isArray(saved.met) ? PEOPLE.filter(id => saved.met.includes(id)) : [],
      coins: saved.stage === 'complete' ? 30 : 0,
      position: safePosition ? { x: position.x, z: position.z, yaw: position.yaw } : null,
    };
  } catch { return initialQuest(); }
}

export function advanceQuest(state, action) {
  if (action.startsWith('talk:')) {
    const id = action.slice(5);
    if (!PEOPLE.includes(id) || state.met.includes(id)) return state;
    return { ...state, met: [...state.met, id] };
  }
  const transitions = { accept: ['meet', 'collect'], pickup: ['collect', 'deliver'], deliver: ['deliver', 'complete'] };
  const transition = transitions[action];
  if (!transition || state.stage !== transition[0]) return state;
  return { ...state, started: true, stage: transition[1], coins: transition[1] === 'complete' ? 30 : 0 };
}
