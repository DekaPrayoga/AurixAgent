import type { Frame, Locator, Page } from 'playwright-core';

export type FormIntent = 'signup' | 'signin';
export type FieldKind =
  | 'email'
  | 'username'
  | 'password'
  | 'newPassword'
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'phone'
  | 'birthDay'
  | 'birthMonth'
  | 'birthYear'
  | 'country'
  | 'otp'
  | 'terms'
  | 'unknown';

export interface FieldMeta {
  index: number;
  tag: string;
  type: string;
  role: string;
  name: string;
  id: string;
  autocomplete: string;
  placeholder: string;
  label: string;
  ariaLabel: string;
  describedBy: string;
  nearbyText: string;
  value: string;
  required: boolean;
  disabled: boolean;
  readonly: boolean;
  editable: boolean;
  formKey: string;
  formText: string;
  scopeSelector: string;
}

export interface FieldCandidate {
  frame: Frame | Page;
  locator: Locator;
  meta: FieldMeta;
  kind: FieldKind;
  confidence: number;
  evidence: string[];
}

export interface FormGroup {
  frame: Frame | Page;
  key: string;
  text: string;
  intent: FormIntent;
  confidence: number;
  fields: FieldCandidate[];
}

export interface FormAssistInput {
  email?: string;
  username?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  phone?: string;
  birthDay?: string;
  birthMonth?: string;
  birthYear?: string;
  country?: string;
  otp?: string;
}

export interface WriteResult {
  kind: FieldKind;
  status: 'verified' | 'missing' | 'failed' | 'preserved';
  confidence?: number;
  reason?: string;
}

export interface FormAssistResult {
  handled: boolean;
  status: 'submitted' | 'next_step' | 'captcha_required' | 'validation_errors' | 'blocked' | 'ambiguous';
  formConfidence: number;
  writes: WriteResult[];
  details: string[];
}
