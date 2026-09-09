export const resume = { name: 'Candidate', title: 'Engineer', summary: '', email: '', phone: '', location: '', skills: [], experience: [{ id: 'r1', company: 'Example', title: 'Engineer', start: '2020', end: 'Present', location: '', bullets: [{ id: 'b1', text: 'Was responsible for writing API tests in Python.' }] }], projects: [], education: [] };
export const job = { title: 'Engineer', company: '', seniority: '', requiredKeywords: [], niceToHaveKeywords: [], responsibilities: [] };
export const input = { resume, job, report: { missingKeywords: [] }, model: 'fixture' };
export function completion(scenario = 'improved') {
  let writes = 0;
  return async ({ system }) => {
    if (system.includes('conservative resume evidence reviewer')) return { valid: true, issues: [] };
    if (system.includes('independently compare')) {
      if (scenario === 'outage') throw new Error('Fixture review outage');
      return { reviews: [{ id: 'b1', decision: scenario === 'improved' ? 'improved' : 'retain', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'The action is stated directly.', dimensions: ['clarity'], nextStep: scenario === 'ask' ? 'ask' : scenario === 'fallback' ? 'revise' : 'keep', question: scenario === 'ask' ? 'Which workflows did the tests cover?' : '', revisionInstruction: 'Clarify the documented task.' }] };
    }
    if (system.includes('ONE entry')) {
      if (++writes > 1 && scenario === 'fallback') throw new Error('Fixture optional revision outage');
      return { id: 'r1', bullets: [{ id: 'b1', text: 'Wrote API tests in Python.', evidence: ['b1'], matchedKeywords: [], rationale: 'Direct action.' }] };
    }
    return { title: resume.title, summary: '', skills: [] };
  };
}
