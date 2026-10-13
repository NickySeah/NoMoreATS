import type { Evidence, EvidenceGroup, Profile } from './types';

export function getEvidenceGroups(profile: Profile): EvidenceGroup[] {
  return [
    ...profile.experience.map(item => ({ id: `experience.${item.id}`, label: `${item.role} at ${item.company}` })),
    ...profile.projects.map(item => ({ id: `project.${item.id}`, label: item.name })),
    ...profile.skills.map(item => ({ id: `skills.${item.id}`, label: `Skills: ${item.name}` })),
  ];
}

/** Each fact carries an identifier and a role/project scope for attribution. */
export function getEvidence(profile: Profile): Evidence[] {
  const evidence: Evidence[] = [];
  const usedIds = new Set<string>();
  const add = (id: string, text: string, group: string) => {
    if (!text.trim()) return;
    if (usedIds.has(id)) throw new Error(`Profile contains a duplicate evidence identifier: ${id}`);
    usedIds.add(id);
    evidence.push({ id, text: text.trim(), group });
  };

  add('profile.summary', profile.summary, 'profile.summary');
  add('profile.additional', profile.additionalEvidence, 'profile.additional');
  for (const role of profile.experience) {
    const group = `experience.${role.id}`;
    add(`${group}.role`, `${role.role} at ${role.company} (${role.dates})`, group);
    role.bullets.forEach((bullet, index) => add(`${group}.bullet.${index}`, bullet, group));
    add(`${group}.notes`, role.notes, group);
  }
  for (const project of profile.projects) {
    const group = `project.${project.id}`;
    add(`${group}.details`, `${project.name}: ${project.technologies}`, group);
    project.bullets.forEach((bullet, index) => add(`${group}.bullet.${index}`, bullet, group));
    add(`${group}.notes`, project.notes, group);
  }
  for (const education of profile.education) {
    const group = `education.${education.id}`;
    add(`${group}.degree`, `${education.degree}, ${education.school} (${education.dates})`, group);
    education.details.forEach((detail, index) => add(`${group}.detail.${index}`, detail, group));
  }
  for (const skill of profile.skills) {
    add(`skills.${skill.id}`, skill.items, `skills.${skill.id}`);
    add(`skills.${skill.id}.notes`, skill.notes || '', `skills.${skill.id}`);
  }
  for (const certificate of profile.certifications) {
    add(`certification.${certificate.id}`, `${certificate.name}, ${certificate.issuer}`, `certification.${certificate.id}`);
  }
  return evidence;
}

