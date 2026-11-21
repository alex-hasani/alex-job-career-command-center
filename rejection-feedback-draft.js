const compact=(value,max=180)=>String(value??'').replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim().slice(0,max);

export function buildRejectionFeedbackDraft({job,language='en',greetingName='',signature=''}={}) {
  if(job?.applicationStatus!=='Rejected')throw Error('Feedback drafts are only available for rejected applications.');
  const german=language==='de',title=compact(job.title),name=compact(greetingName,90),sign=compact(signature,90);
  if(german)return [name?`Guten Tag ${name},`:'Guten Tag,',
    `vielen Dank für Ihre Rückmeldung zu meiner Bewerbung${title?` für die Position „${title}“`:''}.`,
    'Wenn Sie die Möglichkeit haben: Könnten Sie mir kurz sagen, was für Ihre Entscheidung ausschlaggebend war oder was ich bei künftigen Bewerbungen verbessern könnte? Mir ist bewusst, dass Sie nicht verpflichtet sind, individuelles Feedback zu geben. Schon ein kurzer Hinweis würde mir helfen, besser zu verstehen, woran ich arbeiten kann.',
    'Vielen Dank für Ihre Zeit.\n\nFreundliche Grüße'+(sign?'\n'+sign:'')].join('\n\n');
  return [name?`Hello ${name},`:'Hello,',
    `Thank you for letting me know about the outcome of my application${title?` for the ${title} role`:''}.`,
    'If you’re able to share any feedback, I’d be grateful to know what influenced the decision or what I could improve for future applications. I understand you’re not obliged to provide individual feedback, and even a brief note would help me see where I can improve.',
    'Thank you for your time.\n\nBest regards'+(sign?',\n'+sign:'')].join('\n\n');
}

export function openRejectionFeedbackDraft(job){
  if(job?.applicationStatus!=='Rejected')return;
  const create=(tag,text='')=>{const el=document.createElement(tag);el.textContent=text;return el;};
  const dialog=create('dialog'),form=create('form');
  form.style.cssText='display:grid;gap:.65rem;width:min(34rem,78vw);';
  form.append(create('h2','Draft a rejection feedback reply'),create('p','Review and copy the draft, then reply in the original Gmail conversation from the account you used to apply. Don’t reply to a no-reply address. Nothing is sent here.'));
  const field=(label,control)=>{const labelNode=create('label',label);labelNode.style.display='grid';labelNode.append(control);form.append(labelNode);};
  const language=create('select');
  for(const [code,label] of [['en','English'],['de','Deutsch']]){const option=create('option',label);option.value=code;language.append(option);}
  if(/german|deutsch/i.test(job.rawLanguage||'')&&!/english.*accepted/i.test(job.rawLanguage||''))language.value='de';
  const greetingName=create('input');greetingName.maxLength=90;
  const signature=create('input');signature.maxLength=90;
  const body=create('textarea');body.rows=10;
  field('Language (match the rejection email)',language);field('Contact name (optional)',greetingName);field('Your name',signature);field('Editable draft',body);
  const regenerate=()=>{body.value=buildRejectionFeedbackDraft({job,language:language.value,greetingName:greetingName.value,signature:signature.value});};
  regenerate();
  const refresh=create('button','Update draft');refresh.type='button';refresh.onclick=regenerate;
  language.onchange=regenerate;
  const close=create('button','Close');close.type='button';close.onclick=()=>dialog.close();
  const copy=create('button','Copy reply');copy.type='button';
  const status=create('p');status.setAttribute('role','status');
  copy.onclick=async()=>{
    if(!body.value.trim()||/(?:Best regards|Freundliche Grüße)$/.test(body.value.trim())){status.textContent='Add your name and update the draft, or sign it directly.';signature.focus();return;}
    try {await navigator.clipboard.writeText(body.value);status.textContent='Copied. Open the original rejection and review before replying.';}
    catch {body.focus();body.select();status.textContent='Select and copy the draft manually.';}
  };
  form.addEventListener('submit',event=>event.preventDefault());
  form.append(refresh,copy,close,status);dialog.append(form);document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
}
