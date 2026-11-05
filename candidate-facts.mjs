import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readCurrentCandidateFacts(workspace) {
  if(!workspace)return {};
  try {return JSON.parse(await readFile(join(workspace,'Config','candidate-facts.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT')return {};throw error;}
}

export function applyCurrentCandidateFacts(text,facts={}) {
  if(facts.german?.level!=='B1'||facts.german?.courseCompleted!==true)return text;
  return String(text)
    .replace(/der B1-Kurs ist (?:nahezu|fast) abgeschlossen und /gi,'')
    .replace(/the B1 course is nearly complete,? and /gi,'')
    .replace(/\bB1\s*\(Kurs (?:nahezu|fast) abgeschlossen\)/gi,'B1')
    .replace(/\bB1\s*\(course nearly completed?\)/gi,'B1')
    .replace(/\bB1[- ]Kurs (?:nahezu|fast) abgeschlossen/gi,'B1')
    .replace(/\bB1 course nearly completed?/gi,'B1');
}
