/**
 * Universal affordance classifier.
 * One set of rules for every object. A door is a door whether it is on a car or a house.
 */
const FumocaAfford = (() => {
  const RULES = [
    { id: 'engine', match: /engine|ignition|start/i, sound: 'engine', control: 'Start' },
    { id: 'light', match: /light|lamp|headlamp|indicator/i, sound: 'click', control: 'Lights' },
    { id: 'boot', match: /boot|trunk|bonnet|hood/i, sound: 'boot', control: 'Open' },
    { id: 'window', match: /window|glass/i, sound: 'click', control: 'Window' },
    { id: 'door', match: /door|gate|cupboard|cabinet/i, sound: 'door', control: 'Open' },
    { id: 'drawer', match: /drawer|slider/i, sound: 'click', control: 'Slide' },
    { id: 'cap', match: /cap|lid|cover/i, sound: 'cap', control: 'Open' },
    { id: 'wheel', match: /wheel|steer/i, sound: 'click', control: 'Turn' },
  ];

  function classify(name, jointKind) {
    if (!jointKind || jointKind === 'fixed') {
      const engine = RULES.find(r => r.id === 'engine' && r.match.test(name || ''));
      if (engine) return engine;
      return null;
    }
    return RULES.find(r => r.match.test(name || '')) || { id: 'part', match: /.*/, sound: 'click', control: 'Move' };
  }

  function affordances(obj) {
    if (!obj?.components) return [];
    return obj.components.map(c => {
      const a = classify(c.name, c.joint?.kind);
      if (!a) return null;
      return { componentId: c.id, name: c.name, affordance: a.id, sound: a.sound, control: a.control, joint: c.joint?.kind || 'fixed' };
    }).filter(Boolean);
  }

  return { classify, affordances, RULES };
})();

window.FumocaAfford = FumocaAfford;
export default FumocaAfford;
