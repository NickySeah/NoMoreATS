export interface Contact { name: string; email: string; phone: string; location: string; website: string; linkedin: string; github: string }
export interface Experience { id: string; company: string; role: string; dates: string; url: string; bullets: string[]; notes: string }
export interface Project { id: string; name: string; technologies: string; url: string; bullets: string[]; notes: string }
export interface Education { id: string; school: string; degree: string; dates: string; details: string[] }
export interface SkillCategory { id: string; name: string; items: string; notes?: string }
export interface Certification { id: string; name: string; issuer: string; url: string }
export interface Profile { contact: Contact; summary: string; experience: Experience[]; projects: Project[]; education: Education[]; skills: SkillCategory[]; certifications: Certification[]; additionalEvidence: string; updatedAt: string }
export interface Evidence { id: string; text: string; group: string }
export interface TextSlot { id: string; label: string; section: string; original: string; start: number; end: number; maxChars: number; context: string; group: string }
export interface ResumeTemplate { id: string; name: string; source: string; sourceHash: string; slots: TextSlot[]; importedAt: string; baselinePages: number | null; profileBinding?: Profile }
export interface Edit { slotId: string; text: string; reason: string; evidenceIds: string[] }
export interface Requirement { term: string; sourceQuote: string; importance: 'required' | 'preferred'; evidenceIds: string[]; covered: boolean }
export interface Analysis { summary: string; edits: Edit[]; requirements: Requirement[]; gaps: string[]; warnings: string[]; reuseSuggestion: { resumeId: string; reason: string } | null }
export type JobStatus = 'Draft' | 'Applied' | 'Interviewing' | 'Offer' | 'Closed';
export interface JobInput { company: string; role: string; description: string; url: string; instructions: string }
export interface Job extends JobInput { id: string; resumeId: string | null; status: JobStatus; createdAt: string; analysis: Analysis | null; evidenceSnapshot?: Evidence[]; resumeHistory?: string[] }
export interface FollowupQuestion { id: string; question: string; reason: string; sourceQuote: string; targetGroup: string | null }
export interface FollowupAnswer { questionId: string; text: string; group: string }
export interface FollowupRound { id: string; job: JobInput; jobId: string | null; resumeId: string | null; questions: FollowupQuestion[]; answers: FollowupAnswer[]; createdAt: string; answeredAt: string | null; generatedResumeId?: string; generatedJobId?: string }
export interface PdfResult { status: 'ready' | 'unavailable' | 'failed' | 'overflow'; pages: number | null; message: string; warnings: string[] }
export interface Resume { id: string; name: string; createdAt: string; kind: 'original' | 'tailored'; templateId: string; templateHash: string; templateSnapshot: ResumeTemplate; profileSnapshot: Profile; latex: string; analysis: Analysis | null; pdf: PdfResult; model: string | null }
export interface Settings { model: string; apiKeyConfigured: boolean; keySource: 'environment' | 'local' | 'none'; templatePath: string; privacyMode: boolean }
export interface AppState { profile: Profile; template: ResumeTemplate; resumes: Resume[]; jobs: Job[]; settings: Settings; followups?: FollowupRound[] }
export interface TailorResult { resume: Resume | null; job: Job; analysis: Analysis; suggestedResume: Resume | null }
export interface EvidenceGroup { id: string; label: string }
export interface EvidenceQuestion { id: string; term: string; sourceQuote: string; importance: 'required' | 'preferred'; question: string; evidenceIds: string[]; suggestedGroup: string | null }
export interface QuestionAnalysis { summary: string; questions: EvidenceQuestion[] }
export interface EvidenceReview extends QuestionAnalysis { reviewId: string; groups: EvidenceGroup[] }
export interface EvidenceAnswer { questionId: string; disposition: 'answer' | 'no-experience' | 'skip'; text: string; group: string | null }
export interface EvidenceSaveResult { reviewId: string; profile: Profile; savedCount: number }
export interface ModelOption { id: string; name: string; pricing: { prompt: string; completion: string }; context_length: number; supported_parameters?: string[] }
