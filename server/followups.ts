import { z } from 'zod';
import type { FollowupAnswer, FollowupRound, JobInput, Profile } from '../shared/types';
import { profileSchema } from './validation';

export const sameJob = (left: JobInput, right: JobInput) => (['company', 'role', 'description', 'url', 'instructions'] as const).every(key => left[key] === right[key]);
export const followupGroups = (profile: Profile) => [
  ...profile.experience.map(role => ({ id: `experience.${role.id}`, label: `${role.role} at ${role.company}` })),
  ...profile.projects.map(project => ({ id: `project.${project.id}`, label: project.name })),
  { id: 'profile.additional', label: 'General background' },
];
export const followupAnswersSchema = z.object({ answers: z.array(z.object({
  questionId: z.string().min(1).max(80), text: z.string().min(1).max(6000).refine(value => Boolean(value.trim()), 'Enter an answer or leave the question blank.'), group: z.string().min(1).max(100),
}).strict()).max(5) }).strict();

export function appendFollowupAnswers(profile: Profile, round: FollowupRound, answers: FollowupAnswer[]): Profile {
  const groups = new Set(followupGroups(profile).map(group => group.id));
  const questions = new Set(round.questions.map(question => question.id));
  if (new Set(answers.map(answer => answer.questionId)).size !== answers.length) throw new Error('Answer each question only once.');
  const next = structuredClone(profile);
  const append = (existing: string, text: string) => existing.trim() ? `${existing}\n\n${text}` : text;
  for (const answer of answers) {
    if (!questions.has(answer.questionId)) throw new Error('An answer refers to an unknown question.');
    if (!groups.has(answer.group)) throw new Error('Select an existing experience or project for each answer. The profile entry may have changed.');
    if (answer.group === 'profile.additional') next.additionalEvidence = append(next.additionalEvidence, answer.text);
    else if (answer.group.startsWith('experience.')) {
      const role = next.experience.find(role => `experience.${role.id}` === answer.group)!;
      role.notes = append(role.notes, answer.text);
    } else {
      const project = next.projects.find(project => `project.${project.id}` === answer.group)!;
      project.notes = append(project.notes, answer.text);
    }
  }
  next.updatedAt = new Date().toISOString();
  return profileSchema.parse(next);
}
