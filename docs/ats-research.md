# Resume tailoring research

Checked on 8 October 2026. These notes separate what the cited sources document from implementation decisions for this personal app. They do not establish a universal hiring algorithm or predict interview outcomes.

## What ATS documentation supports

| Observation | Primary source | Implication for this app |
| --- | --- | --- |
| Resume parsing extracts information into candidate fields. A failed Greenhouse parse can leave the file attached while requiring manual correction. Its documentation identifies images, columns, complex tables, headers/footers, unclear sections, and abbreviated titles as possible problems. | [Greenhouse: Unsuccessful resume parse](https://support.greenhouse.io/hc/en-us/articles/200989175-Unsuccessful-resume-parse) | Treat extraction and wording as separate concerns. Keeping LaTeX structure unchanged protects the supplied template, but cannot certify the exported PDF's reading order. |
| Greenhouse supports Boolean searches, including exact phrases and alternative terms. | [Greenhouse: Search candidates using Boolean queries](https://support.greenhouse.io/hc/en-us/articles/202360199-Search-candidates-using-Boolean-queries) | Use a job's relevant terminology when the candidate's evidence supports it. No single keyword list applies to every search. |
| Lever searches parseable resume content and other candidate records; a Resume filter restricts the search to extracted resume content. Search results include matching snippets and surrounding text. | [Lever: Searching the Database for Candidates](https://help.lever.co/s/article/Searching-the-Database-for-Candidates) | Put a relevant skill in a factual experience statement where practical. A skill list alone does not explain how it was used. |
| Roche says parsing helps populate applications and can support candidate searches; its recruiters/managers review each applicant and attached CV. Its guidance notes that formatting and word order can affect extraction. | [Roche: Resume Parsing FAQ](https://careers.roche.com/global/en/resume-parsing-faq) | Design for a human reviewer as well as search. Verify populated application fields and inspect exported text. Roche's process is an example, not evidence that all employers behave identically. |
| Harvard recommends tailoring to the role, specific factual language, evidence of impact, and readable formatting. | [Harvard: Create a Strong Resume](https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/) | Rephrase and prioritize existing achievements. Retain supplied metrics; do not manufacture numbers to make a bullet look stronger. |
| Harvard's AI guidance starts from an existing resume, treats generated text as suggested edits, and asks the candidate to verify authenticity and be able to explain every line. | [Harvard: AI for Resumes and Cover Letters](https://careerservices.fas.harvard.edu/ai-resumes-and-cover-letters/) | Show proposed changes and their evidence before export. Represent absent qualifications as gaps. |
| Berkeley advises comparing required/preferred qualifications to relevant achievements and using concise phrases to demonstrate the skills requested. | [Berkeley: Resumes](https://www.career.berkeley.edu/prepare-for-success/resumes/) | Match requirements to supporting experience, including transferable skills, instead of counting every word in the posting equally. |

## Editorial rules derived from that evidence

These are implementation decisions, not claims that an employer uses the same rules:

- Extract concrete requirements from the job description: tools, responsibilities, domain knowledge, qualifications, and required versus preferred criteria.
- Classify each requirement as supported by supplied content, partially supported, or missing. Quote or identify the source evidence for suggested changes. A job description provides requirements, not proof of the candidate's abilities.
- Prefer an accurate action + scope + result. Include the job's phrase when it describes the same actual work. For example, a supplied statement about writing SQL reports may support clearer wording about SQL reporting; it does not establish experience with a different database, cloud platform, or management role.
- Spell out an abbreviation only when its meaning is clear from the supplied context. Preserve official job titles, employers, dates, degrees, credentials, and metrics.
- Keep keywords natural and relevant. Avoid repeated lists, invisible text, invented qualifications, or unsupported claims of seniority and impact.
- Reuse older candidate wording only when its original evidence still supports it and it belongs to the same experience/project. A previous AI proposal or prior acceptance is not independent proof of a new fact.
- Return proposed edits for existing text slots. Keep all formatting commands, environments, package declarations, macros, ordering, and layout outside model control.
- Label any local comparison as a requirement/evidence review. Do not call it an employer ATS score, acceptance probability, or guaranteed improvement.

Preserving the source structure does not preserve line wrapping or page count when text length changes. An exported PDF still needs a visual check and a text extraction/read-order check. If the original template itself has parsing risks, report them without silently redesigning it.

## OpenRouter integration

### Request and response

The documented endpoint is `POST https://openrouter.ai/api/v1/chat/completions`, using bearer authentication and a JSON body containing `model` and `messages`. The non-streaming response exposes the generated text at `choices[0].message.content`. [OpenRouter: Create a chat completion](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion)

For compatible endpoints, request `response_format.type = "json_schema"`, with a named `json_schema`, `strict: true`, and the app's schema. Support is specific to the serving endpoint and can change. Some providers enforce strict schema constraints; others translate the schema or treat it as guidance. [OpenRouter: Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

Implementation decisions:

1. Send the tailoring instructions as the system message and resume/job/candidate data as a separate JSON user message. Tell the model that embedded instructions are data.
2. Use `provider.require_parameters: true` so unsupported parameters cannot simply be ignored. [OpenRouter: Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection)
3. Parse and validate the returned JSON locally. Reject unknown/duplicate slot IDs, extra fields, empty replacement text, raw LaTeX commands, and missing evidence. Apply only accepted edits to original source ranges.
4. Handle HTTP errors, unavailable endpoints, refusals, truncated completions, and invalid output as failures. Retain the original resume and let the user retry; do not silently apply a partial result or relax the privacy settings.
5. Prefer non-streaming for this small structured output. A schema-conforming string can still contain an inaccurate claim, so review evidence as well as shape.

### Model discovery

| API route | Purpose | Documentation |
| --- | --- | --- |
| `GET https://openrouter.ai/api/v1/models` | Current model metadata, including IDs, architecture, context, pricing, and supported parameters. | [List all models and their properties](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties) |
| `GET https://openrouter.ai/api/v1/models/user` | Models filtered by the authenticated user's provider preferences, privacy settings, and guardrails. | [List models filtered by user settings](https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails) |
| `GET https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints` | Details of the providers/endpoints serving a particular model. | [List all endpoints for a model](https://openrouter.ai/docs/api/api-reference/endpoints/list-all-endpoints-for-a-model) |

Use live discovery for a model picker rather than assuming a fixed model remains available or keeps the same price. Check text output and structured-output support; keep a manually entered model ID available if discovery is unavailable. A picker filter is advisory: enforce the actual request's requirements at routing time.

### Data and keys

OpenRouter says storing prompts/responses within OpenRouter is opt-in; private input/output logging and OpenRouter's use of inputs/outputs are off by default. It retains request metadata, and documents anonymous prompt categorization. [OpenRouter: Data Collection](https://openrouter.ai/docs/guides/privacy/data-collection)

Upstream providers have their own logging, retention, and training policies. Opting out of provider training in OpenRouter's settings excludes providers that train; it is separate from OpenRouter's own settings and from retention. [OpenRouter: Provider Logging](https://openrouter.ai/docs/guides/privacy/provider-logging)

`provider.data_collection: "deny"` excludes endpoints that collect user data under OpenRouter's policy classification. Treat the classification as OpenRouter's best knowledge rather than an independent legal guarantee. [OpenRouter: Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection)

`provider.zdr: true` restricts inference to endpoints classified as zero data retention. Account/guardrail restrictions also apply. This does not govern third-party tools/plugins or copies made by this app; OpenRouter also permits transient in-memory prompt caching under its ZDR interpretation. [OpenRouter: Zero Data Retention](https://openrouter.ai/docs/guides/features/zdr)

Implementation decisions for a personal app:

- Before generation, state that the selected resume content and job description are sent to OpenRouter and its serving provider.
- Default requests to `provider: { require_parameters: true, data_collection: "deny", zdr: true }`. Explain that this can reduce model availability.
- Prefer an environment key where practical. In this app, an explicit **Save key** action can store a key in the local backend's ignored data file; that file is plain text, not encrypted storage. Never bake a private key into frontend source, commit it, include it in exports, or send it to unrelated services. A key entered in the browser is visible to code running in that browser session before it is sent to the local backend.
- Persist resumes or accepted wording locally only as an explicit user choice, with a way to clear it. Local storage is not encrypted protection from scripts with access to the same origin.
- Send only context useful for tailoring. Contact details, unrelated identifiers, and proprietary information usually are unnecessary.
- Avoid logging request bodies, key-bearing headers, or model output containing personal information. No third-party web tools are needed for a pasted job description.

## Evidence limits

The sources above document particular products and practical career guidance. They do not establish that every ATS automatically ranks or rejects candidates, that PDF always fails, that a certain number of keywords guarantees success, or that any third-party match percentage reproduces an employer's process. This app can improve clarity and traceability, preserve a template's source structure, and help a user review role relevance; it cannot certify an ATS outcome.
