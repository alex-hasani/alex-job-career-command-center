const variants = [
  'English teacher', 'Englischlehrer', 'ESL teacher', 'Lehrkraft Englisch',
  'EFL teacher', 'English language teacher', 'English instructor',
  'English tutor', 'Business English teacher', 'TEFL teacher',
  'TESOL teacher', 'ELT teacher', 'Englisch Lehrer', 'Sprachtrainer Englisch'
];

export function teachingSearchTerms(query='') {
  const entered=String(query).trim();
  if (!entered) return [...variants];
  if (/\b(?:english|englisch\w*|esl|efl|tefl|tesol|elt)\b/i.test(entered) &&
      /\b(?:teacher|lehrer\w*|lehrkraft|teaching|tutor|trainer|dozent|unterricht|englisch(?:lehrer|trainer|dozent|unterricht)\w*)\b/i.test(entered))
    return [...new Set([entered,...variants])];
  return [entered];
}
