const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const english = /\b(?:english|englisch\w*|esl|efl|tefl|tesol|elt)\b/i;
const teaching = /\b(?:teacher|teaching|tutor|instructor|educator|trainer|dozent\w*|lehrer\w*|lehrkraft|sprachlehrer\w*|sprachtrainer\w*|nachhilfelehrer\w*|unterricht\w*|englisch(?:lehrer|trainer|dozent|unterricht|nachhilfe)\w*)\b/i;
const otherLanguage = /\b(?:german|deutsch\w*|daf|daz|russian|russisch\w*|french|französisch\w*|spanish|spanisch\w*|italian|italienisch\w*|arabic|arabisch\w*|chinese|chinesisch\w*)\b/i;
const otherLanguageTeacher = /\b(?:german|deutsch\w*|russian|russisch\w*|french|französisch\w*|spanish|spanisch\w*|italian|italienisch\w*|arabic|arabisch\w*|chinese|chinesisch\w*|daf|daz)\b.{0,25}\b(?:teacher|tutor|trainer|instructor|lehrer\w*|lehrkraft|dozent\w*)\b|\b(?:teacher|tutor|trainer|instructor|lehrer\w*|lehrkraft|dozent\w*)\b\s+(?:(?:of|for|für|im fach)\s+)\b(?:german|deutsch\w*|russian|russisch\w*|french|französisch\w*|spanish|spanisch\w*|italian|italienisch\w*|arabic|arabisch\w*|chinese|chinesisch\w*|daf|daz)\b/i;
const englishInstruction = /\b(?:teach(?:ing|es)?|tutor(?:ing)?|instruct(?:ion)?|unterricht\w*|nachhilfe|lessons?|classes?|kurs\w*|fach)\b.{0,55}\b(?:english|englisch\w*|esl|efl|tefl|tesol|elt)\b|\b(?:english|englisch\w*|esl|efl|tefl|tesol|elt)\b.{0,55}\b(?:lessons?|classes?|unterricht\w*|kurs\w*|subject|fach|teach(?:ing)?|tutor(?:ing)?|instruction)\b/i;

export function relevantTeachingPosition(title, description) {
  const role = plain(title), details = plain(description);
  const subjectRole = role.replace(/\b(?:english[- ]speaking|englischsprachig)\b/gi, '');
  if (!teaching.test(role)) return false;
  if (otherLanguageTeacher.test(role) ||
      (otherLanguage.test(role) && !/\b(?:german[- ]speaking|deutschsprachig)\b/i.test(role))) return false;
  return english.test(subjectRole) || englishInstruction.test(details);
}
