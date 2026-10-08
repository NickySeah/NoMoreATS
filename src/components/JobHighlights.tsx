import type { Analysis } from '../../shared/types'

export function JobHighlights({ analysis, evidence }: { analysis: Analysis; evidence: Map<string, string> }) {
  const matches = analysis.requirements
    .filter(requirement => requirement.evidenceIds.some(id => evidence.has(id)))
    .sort((left, right) => Number(right.covered) - Number(left.covered) || Number(right.importance === 'required') - Number(left.importance === 'required'))
    .slice(0, 5)

  return <section className="job-highlights" aria-label="Important points for this job">
    <h3 className="detail-section-title">What to highlight for this job</h3>
    <p className="job-highlights-intro">Your strongest matches first, followed by related evidence that needs confirmation. Highlight the facts you can support and review any remaining gaps.</p>
    {matches.length ? <div className="job-highlights-grid">{matches.map((requirement, index) => <article className="job-highlight-card" key={`${requirement.term}-${index}`}>
      <h4>{requirement.term}<span>{requirement.importance}</span></h4>
      <p className={`match-status ${requirement.covered ? 'full' : 'partial'}`}>{requirement.covered ? 'Fully supported' : 'Partial match — confirm the remaining criteria'}</p>
      <blockquote>“{requirement.sourceQuote}”</blockquote>
      <strong>Your relevant evidence</strong>
      <ul>{[...new Set(requirement.evidenceIds)].filter(id => evidence.has(id)).map(id => <li key={id}>{evidence.get(id)}</li>)}</ul>
    </article>)}</div> : <p className="job-highlights-intro">No related evidence was identified. Add specific accomplishments to My profile and review the gaps below.</p>}
  </section>
}
