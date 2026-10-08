import type { Evidence, Profile } from '../shared/types.js';

export const seedProfile: Profile = {
  contact: {
    name: 'Nicholas Seah', email: 'nicholasseah02@gmail.com', phone: '(+65) 97662050',
    location: 'Singapore', website: 'https://nicholasseah.netlify.app/',
    linkedin: 'https://linkedin.com/in/nicholasseah', github: 'https://github.com/NickySeah',
  },
  summary: '',
  experience: [
    {
      id: 'govtech', company: 'GovTech', role: 'Software Engineer Intern', dates: 'Jun 2026 – Present',
      url: 'https://www.tech.gov.sg/', notes: '',
      bullets: [
        'Built an API observability dashboard backed by DynamoDB audit logs, surfacing request volume and p95/p99 latency metrics for data producers to monitor API usage and performance.',
        'Developed an administrative activity-log interface backed by DynamoDB audit records, enabling administrators to trace user actions and investigate platform activity.',
        'Designed and implemented automated KMS permission handling for AWS Glue Crawlers, removing manual key-policy configuration during encrypted S3 data-source onboarding.',
      ],
    },
    {
      id: 'ncs', company: 'NCS PTE. LTD.', role: 'Software Engineer Intern', dates: 'Dec 2025 – Jun 2026',
      url: 'https://www.ncs.co/en-sg/', notes: '',
      bullets: [
        'Refactored legacy .NET MVC logic across inbound and outbound interfaces, reducing duplicated code paths by extracting shared validation and transformation components.',
        'Diagnosed and resolved defects in scheduled .NET batch jobs, tracing failures across application logic and database workflows before validating fixes for production change requests.',
        'Identified gaps in developer onboarding and created a standardized setup guide covering local configuration and dependencies for incoming developers.',
      ],
    },
  ],
  projects: [
    {
      id: 'pegasuscrm', name: 'PegasusCRM', technologies: 'TypeScript, AWS Amplify, Cognito, Lambda',
      url: 'https://github.com/JabrielHo/CS301-PegasusCRM', notes: '',
      bullets: [
        'Worked directly with UBS stakeholders to translate business requirements into technical specifications and sprint-ready engineering tasks.',
        'Built a TypeScript frontend with AWS Amplify and generated GraphQL types, enforcing typed API contracts between UI components and backend services.',
        'Implemented role-based API authorization using Cognito/OAuth 2.0 tokens and a Lambda authorizer that validated JWTs and user roles on each protected request.',
      ],
    },
    {
      id: 'pokeswap', name: 'PokeSwap', technologies: 'RabbitMQ, Docker, Kong',
      url: 'https://github.com/leandrogay/PokeSwap', notes: '',
      bullets: [
        'Architected RabbitMQ-based asynchronous messaging across 4 microservices and validated the workflow under simulations of 50+ concurrent card transfers.',
        'Containerized the microservice stack with Docker Compose and configured Kong API Gateway for centralized routing and CORS across service endpoints.',
      ],
    },
    {
      id: 'dutynotfree', name: 'DutyNotFree', technologies: 'Spring Boot, JWT, MySQL',
      url: 'https://github.com/NickySeah/DutyNotFree', notes: '',
      bullets: [
        'Led Agile delivery for a 5-member engineering team, coordinating sprint planning, task ownership, dependencies, and milestones in Jira.',
        'Built a Spring Boot backend with JWT-based authentication and unit tests covering protected endpoints and core service logic.',
      ],
    },
  ],
  education: [{
    id: 'smu', school: 'Singapore Management University', degree: 'Bachelor of Science (Software Engineering)',
    dates: 'Aug 2023 – Jan 2027',
    details: ['GPA: 3.53/4.0', 'Second Major in Tech and Business (Product Development)'],
  }],
  skills: [
    { id: 'languages', name: 'Languages', items: 'C#, Java, Python, TypeScript, JavaScript' },
    { id: 'frameworks', name: 'Frameworks', items: '.NET, Spring Boot, React, Next.js, Vue.js, Express' },
    { id: 'cloud', name: 'Cloud & Infrastructure', items: 'AWS, AWS CDK, Docker, RabbitMQ, Kong' },
    { id: 'databases', name: 'Databases & Tools', items: 'MySQL, MongoDB, DynamoDB, Supabase, Git, SSMS, Tableau' },
  ],
  certifications: [
    {
      id: 'aws-solutions-architect', name: 'AWS Certified Solutions Architect – Associate', issuer: 'Amazon Web Services',
      url: 'https://www.credly.com/badges/95267b1a-fc80-4af4-b35b-1c865d6dc534/linked_in_profile',
    },
    {
      id: 'ai100', name: 'AI100: Python Programming and Data Visualization', issuer: 'Heicoders Academy',
      url: 'https://cert.heicodersacademy.com/30ULUT1BHW',
    },
    { id: 'infocomm', name: 'Advanced Certificate in Infocomm Technology', issuer: 'SkillsFuture SG', url: '' },
  ],
  additionalEvidence: '', updatedAt: new Date().toISOString(),
};

export { getEvidence } from '../shared/evidence';

