import type { Frame, Locator, Page } from 'playwright-core';
import type {
  FieldCandidate,
  FieldKind,
  FieldMeta,
  FormAssistInput,
  FormAssistResult,
  FormGroup,
  FormIntent,
  WriteResult,
} from './types.js';

const FIELD_SELECTOR = 'input, select, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]';
const NEGATIVE_FORM = /search|newsletter|subscribe|contact|payment|card|coupon|captcha|verification code/i;
const SIGNUP_FORM = /sign.?up|register|create account|join|new account|get started/i;
const SIGNIN_FORM = /sign.?in|log.?in|welcome back|current password/i;

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function includesAny(text: string, words: RegExp): boolean {
  return words.test(normalized(text));
}

export function classifyField(meta: FieldMeta, intent: FormIntent): Pick<FieldCandidate, 'kind' | 'confidence' | 'evidence'> {
  const text = normalized([
    meta.autocomplete,
    meta.type,
    meta.label,
    meta.ariaLabel,
    meta.placeholder,
    meta.name,
    meta.id,
    meta.nearbyText,
  ].join(' '));
  const scores = new Map<FieldKind, { score: number; evidence: string[] }>();
  const add = (kind: FieldKind, score: number, evidence: string) => {
    const current = scores.get(kind) || { score: 0, evidence: [] };
    current.score += score;
    current.evidence.push(evidence);
    scores.set(kind, current);
  };

  const ac = meta.autocomplete.toLowerCase();
  if (ac.includes('email')) add('email', 100, 'autocomplete=email');
  if (ac.includes('username')) add('username', 95, 'autocomplete=username');
  if (ac.includes('new-password')) add('newPassword', 110, 'autocomplete=new-password');
  if (ac.includes('current-password')) add('password', 110, 'autocomplete=current-password');
  if (ac.includes('given-name')) add('firstName', 100, 'autocomplete=given-name');
  if (ac.includes('family-name')) add('lastName', 100, 'autocomplete=family-name');
  if (ac === 'name') add('fullName', 95, 'autocomplete=name');
  if (ac.includes('tel')) add('phone', 100, 'autocomplete=tel');
  if (ac.includes('bday-day')) add('birthDay', 100, 'autocomplete=bday-day');
  if (ac.includes('bday-month')) add('birthMonth', 100, 'autocomplete=bday-month');
  if (ac.includes('bday-year')) add('birthYear', 100, 'autocomplete=bday-year');
  if (ac.includes('country')) add('country', 100, 'autocomplete=country');
  if (ac.includes('one-time-code')) add('otp', 110, 'autocomplete=one-time-code');

  if (meta.type === 'email') add('email', 80, 'type=email');
  if (meta.type === 'password') add(intent === 'signup' ? 'newPassword' : 'password', 75, 'type=password');
  if (meta.type === 'tel') add('phone', 70, 'type=tel');
  if (meta.type === 'checkbox') add('terms', 35, 'type=checkbox');

  if (includesAny(text, /\bemail|e-mail\b/i)) add('email', 65, 'semantic=email');
  if (includesAny(text, /\buser.?name|handle\b/i)) add('username', 65, 'semantic=username');
  if (includesAny(text, /\bpassword|passcode\b/i)) add(intent === 'signup' ? 'newPassword' : 'password', 60, 'semantic=password');
  if (includesAny(text, /\bfirst|given\b.*\bname\b|\bname.*first\b/i)) add('firstName', 65, 'semantic=first-name');
  if (includesAny(text, /\blast|family|surname\b.*\bname\b|\bname.*last\b/i)) add('lastName', 65, 'semantic=last-name');
  if (includesAny(text, /\bfull name|your name|display name\b/i)) add('fullName', 55, 'semantic=full-name');
  if (includesAny(text, /\bphone|mobile|telephone\b/i)) add('phone', 65, 'semantic=phone');
  if (includesAny(text, /\bday\b/i)) add('birthDay', 35, 'semantic=day');
  if (includesAny(text, /\bmonth\b/i)) add('birthMonth', 35, 'semantic=month');
  if (includesAny(text, /\byear|birth year\b/i)) add('birthYear', 40, 'semantic=year');
  if (includesAny(text, /\bcountry|region\b/i)) add('country', 55, 'semantic=country');
  if (includesAny(text, /\botp|one.?time|verification code|security code\b/i)) add('otp', 70, 'semantic=otp');
  if (includesAny(text, /terms|privacy|agree|consent/i)) add('terms', 55, 'semantic=terms');

  if (/search|newsletter|subscribe/.test(text)) {
    for (const entry of scores.values()) entry.score -= 150;
  }
  const best = [...scores.entries()].sort((a, b) => b[1].score - a[1].score)[0];
  if (!best || best[1].score < 35) return { kind: 'unknown', confidence: 0, evidence: [] };
  return {
    kind: best[0],
    confidence: Math.min(1, best[1].score / 120),
    evidence: best[1].evidence,
  };
}

async function scanFrame(frame: Frame | Page, intent: FormIntent): Promise<FieldCandidate[]> {
  const locator = frame.locator(FIELD_SELECTOR);
  const count = Math.min(await locator.count(), 80);
  const output: FieldCandidate[] = [];
  for (let index = 0; index < count; index++) {
    const field = locator.nth(index);
    try {
      if (!(await field.isVisible()) || !(await field.isEnabled())) continue;
      const meta = await field.evaluate((element: Element, fieldIndex: number) => {
        const el = element as HTMLInputElement;
        const labels = 'labels' in el && el.labels ? Array.from(el.labels).map((label) => label.textContent || '').join(' ') : '';
        const labelledBy = element.getAttribute('aria-labelledby') || '';
        const ariaText = labelledBy.split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent || '').join(' ');
        const describedBy = (element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent || '').join(' ');
        const form = el.form || element.closest('form');
        const container = form || element.closest('[role="dialog"], [role="form"], section, main, article, div');
        const heading = container?.querySelector('h1,h2,h3,[role="heading"]')?.textContent || '';
        const parentText = element.parentElement?.textContent || '';
        const formIndex = form ? Array.from(document.forms).indexOf(form as HTMLFormElement) : -1;
        const containers = Array.from(document.querySelectorAll('form, [role="dialog"], [role="form"], section, main, article, div'));
        const containerIndex = container ? containers.indexOf(container) : -1;
        const scopeId = `aurix-${formIndex >= 0 ? `form-${formIndex}` : `container-${containerIndex}`}`;
        container?.setAttribute('data-aurix-form-scope', scopeId);
        return {
          index: fieldIndex,
          tag: element.tagName.toLowerCase(),
          type: (el.type || '').toLowerCase(),
          role: element.getAttribute('role') || '',
          name: el.name || '',
          id: el.id || '',
          autocomplete: element.getAttribute('autocomplete') || '',
          placeholder: element.getAttribute('placeholder') || '',
          label: `${labels} ${ariaText}`.trim(),
          ariaLabel: element.getAttribute('aria-label') || '',
          describedBy,
          nearbyText: `${heading} ${parentText.slice(0, 240)}`.trim(),
          value: el.value || element.textContent || '',
          required: Boolean(el.required || element.getAttribute('aria-required') === 'true'),
          disabled: Boolean(el.disabled || element.getAttribute('aria-disabled') === 'true'),
          readonly: Boolean(el.readOnly),
          editable: !el.disabled && !el.readOnly,
          formKey: form ? `form:${formIndex}` : `container:${containerIndex}`,
          formText: `${heading} ${(container?.textContent || '').slice(0, 500)}`.trim(),
          scopeSelector: `[data-aurix-form-scope="${scopeId}"]`,
        } satisfies FieldMeta;
      }, index);
      if (!meta.editable || meta.disabled || meta.readonly) continue;
      const classification = classifyField(meta, intent);
      output.push({ frame, locator: field, meta, ...classification });
    } catch {}
  }
  return output;
}

export async function scanForms(page: Page, intent: FormIntent): Promise<FormGroup[]> {
  const frames: Array<Frame | Page> = [page, ...page.frames().filter((frame) => frame !== page.mainFrame())];
  const candidates = (await Promise.all(frames.map((frame) => scanFrame(frame, intent)))).flat();
  const groups = new Map<string, FieldCandidate[]>();
  for (const candidate of candidates) {
    const frameUrl = 'url' in candidate.frame ? candidate.frame.url() : '';
    const key = `${frameUrl}|${candidate.meta.formKey}`;
    const list = groups.get(key) || [];
    list.push(candidate);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, fields]) => {
    const text = fields[0]?.meta.formText || '';
    let score = fields.reduce((sum, field) => sum + field.confidence * 20, 0);
    if (intent === 'signup' && SIGNUP_FORM.test(text)) score += 60;
    if (intent === 'signin' && SIGNIN_FORM.test(text)) score += 60;
    if (NEGATIVE_FORM.test(text)) score -= 80;
    const kinds = new Set(fields.map((field) => field.kind));
    if (kinds.has('email') || kinds.has('username')) score += 20;
    if (kinds.has(intent === 'signup' ? 'newPassword' : 'password')) score += 30;
    return { frame: fields[0].frame, key, text, intent, confidence: Math.max(0, Math.min(1, score / 140)), fields };
  }).sort((a, b) => b.confidence - a.confidence);
}

function expectedKindEntries(input: FormAssistInput, intent: FormIntent): Array<[FieldKind, string]> {
  const entries: Array<[FieldKind, string | undefined]> = [
    ['email', input.email],
    ['username', input.username],
    [intent === 'signup' ? 'newPassword' : 'password', input.password],
    ['firstName', input.firstName],
    ['lastName', input.lastName],
    ['fullName', input.fullName],
    ['phone', input.phone],
    ['birthDay', input.birthDay],
    ['birthMonth', input.birthMonth],
    ['birthYear', input.birthYear],
    ['country', input.country],
    ['otp', input.otp],
  ];
  return entries.filter((entry): entry is [FieldKind, string] => Boolean(entry[1]));
}

function selectValues(kind: FieldKind, value: string): string[] {
  const values = [value];
  if (kind === 'birthMonth') {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const index = months.indexOf(normalized(value));
    if (index >= 0) values.push(String(index + 1), String(index + 1).padStart(2, '0'), months[index].slice(0, 3));
  }
  if (kind === 'country') {
    const countryCodes: Record<string, string> = { 'united states': 'US', 'united kingdom': 'GB', indonesia: 'ID', india: 'IN', canada: 'CA', australia: 'AU' };
    const code = countryCodes[normalized(value)];
    if (code) values.push(code);
  }
  return [...new Set(values)];
}

async function writeField(candidate: FieldCandidate, value: string): Promise<WriteResult> {
  const secret = candidate.kind === 'password' || candidate.kind === 'newPassword';
  const expected = value.trim();
  try {
    const actualBefore = await candidate.locator.inputValue().catch(() => '');
    if (normalized(actualBefore) === normalized(expected)) {
      return { kind: candidate.kind, status: 'preserved', confidence: candidate.confidence };
    }
    if (candidate.meta.tag === 'select') {
      const options = selectValues(candidate.kind, expected);
      let selected = false;
      for (const option of options) {
        try {
          const result = await candidate.locator.selectOption({ label: option }).catch(() => candidate.locator.selectOption(option));
          if (result.length) { selected = true; break; }
        } catch {}
      }
      if (!selected) return { kind: candidate.kind, status: 'failed', confidence: candidate.confidence, reason: 'no matching select option' };
      const selectedData = await candidate.locator.locator('option:checked').evaluate((option) => ({ text: option.textContent || '', value: (option as HTMLOptionElement).value }));
      if (!options.some((option) => normalized(option) === normalized(selectedData.text) || normalized(option) === normalized(selectedData.value))) {
        return { kind: candidate.kind, status: 'failed', confidence: candidate.confidence, reason: 'selected option did not match requested value' };
      }
      return { kind: candidate.kind, status: 'verified', confidence: candidate.confidence };
    }
    await candidate.locator.fill(expected);
    await candidate.locator.page().waitForTimeout(120);
    let actual = await candidate.locator.inputValue().catch(() => '');
    if (normalized(actual) !== normalized(expected)) {
      await candidate.locator.click();
      await candidate.locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await candidate.locator.pressSequentially(expected, { delay: secret ? 25 : 12 });
      actual = await candidate.locator.inputValue().catch(() => '');
    }
    if (normalized(actual) !== normalized(expected)) {
      return { kind: candidate.kind, status: 'failed', confidence: candidate.confidence, reason: 'value did not persist after verified fill' };
    }
    return { kind: candidate.kind, status: 'verified', confidence: candidate.confidence };
  } catch (error: any) {
    return { kind: candidate.kind, status: 'failed', confidence: candidate.confidence, reason: String(error?.message || error).slice(0, 180) };
  }
}

async function findSubmit(group: FormGroup): Promise<Locator | undefined> {
  const scope = group.frame.locator(group.fields[0].meta.scopeSelector);
  const buttons = scope.locator('button:visible, input[type="submit"]:visible, [role="button"]:visible');
  const count = Math.min(await buttons.count(), 40);
  let best: { locator: Locator; score: number } | undefined;
  for (let index = 0; index < count; index++) {
    const button = buttons.nth(index);
    try {
      if (!(await button.isEnabled())) continue;
      const data = await button.evaluate((element) => ({
        text: `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${(element as HTMLInputElement).value || ''}`.trim(),
        formText: ((element as HTMLButtonElement).form?.textContent || element.closest('form,[role="dialog"],[role="form"]')?.textContent || '').slice(0, 500),
      }));
      const text = normalized(data.text);
      let score = 0;
      const signup = /sign.?up|register|create account|join|get started/.test(text);
      const signin = /sign.?in|log.?in/.test(text);
      if (group.intent === 'signup') score += signup ? 60 : signin ? -60 : 0;
      else score += signin ? 60 : signup ? -60 : 0;
      if (/submit|continue|next/.test(text)) score += 40;
      if (/google|apple|facebook|github|oauth|newsletter|subscribe|cookie|cancel|back/.test(text)) score -= 100;
      if (normalized(data.formText).includes(normalized(group.text).slice(0, 80))) score += 25;
      if (!best || score > best.score) best = { locator: button, score };
    } catch {}
  }
  return best && best.score >= 40 ? best.locator : undefined;
}

export async function runFormAssist(page: Page, intent: FormIntent, input: FormAssistInput): Promise<FormAssistResult> {
  const groups = await scanForms(page, intent);
  const group = groups[0];
  if (!group || group.confidence < 0.35) {
    return { handled: false, status: 'ambiguous', formConfidence: group?.confidence || 0, writes: [], details: ['No high-confidence form group found'] };
  }
  const writes: WriteResult[] = [];
  for (const [kind, value] of expectedKindEntries(input, intent)) {
    const candidates = group.fields.filter((field) => field.kind === kind && field.confidence >= 0.35).sort((a, b) => b.confidence - a.confidence);
    if (!candidates.length) {
      writes.push({ kind, status: 'missing', reason: 'no confident field candidate' });
      continue;
    }
    const targets = intent === 'signup' && kind === 'newPassword'
      ? candidates.filter((candidate, index) => index === 0 || candidate.meta.required || /confirm|repeat|again/i.test(`${candidate.meta.label} ${candidate.meta.name} ${candidate.meta.id} ${candidate.meta.placeholder}`))
      : candidates.slice(0, 1);
    for (const candidate of targets) writes.push(await writeField(candidate, value));
  }
  const failed = writes.filter((write) => write.status === 'failed');
  if (failed.length) return { handled: true, status: 'validation_errors', formConfidence: group.confidence, writes, details: failed.map((write) => `${write.kind}: ${write.reason}`) };
  const missing = writes.filter((write) => write.status === 'missing');
  if (missing.length) return { handled: true, status: 'ambiguous', formConfidence: group.confidence, writes, details: missing.map((write) => `${write.kind}: ${write.reason}`) };
  const submit = await findSubmit(group);
  if (!submit) return { handled: true, status: 'next_step', formConfidence: group.confidence, writes, details: ['Fields verified; no scoped submit button found'] };
  const beforeUrl = page.url();
  await submit.click();
  await page.waitForTimeout(1200);
  const pageText = await page.locator('body').innerText().catch(() => '');
  const captcha = /captcha|verify you are human|security check/i.test(pageText) || page.frames().some((frame) => /captcha|challenges\.cloudflare/i.test(frame.url()));
  if (captcha) return { handled: true, status: 'captcha_required', formConfidence: group.confidence, writes, details: ['Form submitted; verification widget detected'] };
  const validation = group.frame.locator(':invalid:visible, [aria-invalid="true"]:visible, .error:visible, [role="alert"]:visible');
  const validationCount = await validation.count().catch(() => 0);
  if (validationCount > 0) return { handled: true, status: 'validation_errors', formConfidence: group.confidence, writes, details: [(await validation.first().innerText().catch(() => 'Validation failed')).slice(0, 220)] };
  return { handled: true, status: page.url() !== beforeUrl ? 'submitted' : 'next_step', formConfidence: group.confidence, writes, details: [page.url() !== beforeUrl ? 'Navigation completed' : 'Form advanced without navigation'] };
}

export function formatFormAssistResult(result: FormAssistResult): string {
  const lines = [`[FORM_INTELLIGENCE] status=${result.status} confidence=${result.formConfidence.toFixed(2)}`];
  for (const write of result.writes) lines.push(`- ${write.kind}: ${write.status}${write.reason ? ` (${write.reason})` : ''}`);
  for (const detail of result.details) lines.push(`- ${detail}`);
  return lines.join('\n');
}
