-- =====================================================================
-- HASC Center LMS — Supabase schema
-- Generated from the in-app handoff package on 2026-07-31T20:29:18.146Z
-- Regenerate with: Admin > System Center > Supabase handoff > Export SQL
-- Do not hand-edit: change the handoff package and regenerate.
--
-- Review before running. Policies whose scope is documented as prose rather
-- than SQL are emitted as TODO and will NOT compile until written. That is
-- deliberate — an invented policy that looks plausible is a security defect.
-- =====================================================================

create extension if not exists citext;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Helper functions. These are the ONLY place scope is defined: policies,
-- reports and exports must all call them so the four portals cannot drift.
-- ---------------------------------------------------------------------
-- current_user_id() -> uuid  ·  Authenticated Supabase identity.
create or replace function current_user_id()
  returns uuid language sql stable security definer set search_path = public as $$
  SELECT auth.uid();
$$;

-- current_role() -> text  ·  Server-controlled portal role.   [emitted as hasc_current_role() — the documented name is a reserved Postgres identifier]
create or replace function hasc_current_role()
  returns text language sql stable security definer set search_path = public as $$
  SELECT role FROM users WHERE id=auth.uid() AND active;
$$;

-- current_staff_id() -> uuid  ·  Staff self-scope.
create or replace function current_staff_id()
  returns uuid language sql stable security definer set search_path = public as $$
  SELECT id FROM staff WHERE user_id=auth.uid() AND active;
$$;

-- current_manager_id() -> uuid  ·  Manager/Area Coordinator identity.
create or replace function current_manager_id()
  returns uuid language sql stable security definer set search_path = public as $$
  SELECT id FROM managers WHERE user_id=auth.uid() AND active;
$$;

-- authorized_location_ids() -> TABLE(location_id uuid)  ·  Single location-scope source for UI, RLS, reports, and exports.
-- TODO(write): Manager direct locations plus supervised-manager locations; admin all active locations.
-- create or replace function authorized_location_ids() returns TABLE(location_id uuid) ...

-- manager_staff_scope() -> TABLE(staff_id uuid)  ·  Single manager/AC staff-scope source.
-- TODO(write): Active staff assigned to authorized_location_ids().
-- create or replace function manager_staff_scope() returns TABLE(staff_id uuid) ...

-- can_access_staff(p_staff_id uuid) -> boolean  ·  Reusable policy predicate.
-- TODO(write): Admin OR self OR p_staff_id in manager scope OR instructor session roster.
-- create or replace function can_access_staff(p_staff_id uuid) returns boolean ...

-- is_instructor_for_session(p_session_id uuid) -> boolean  ·  Instructor attendance/session scope.
-- TODO(write): auth.uid() exists in session_instructors for p_session_id.
-- create or replace function is_instructor_for_session(p_session_id uuid) returns boolean ...

-- write_audit_event(...) -> uuid  ·  Only supported audit write path.
-- TODO(write): Append-only insert into audit_logs using auth.uid(), request and correlation metadata.
-- create or replace function write_audit_event(...) returns uuid ...

-- calculate_art_due_date(p_staff_id uuid) -> timestamptz  ·  Canonical ART rule across dashboards/reports/assignments.
-- TODO(write): Initial ART = one year after required Orientation 1/2/3 completion; SDCH path = one year after SDCH 1/2 or full orientation equivalency; renewals from ART completion.
-- create or replace function calculate_art_due_date(p_staff_id uuid) returns timestamptz ...

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
-- users: Supabase Auth profile mirror, portal role, employee login identity, timezone, and account state.
-- soft delete: active=false (never DELETE — history must survive)
create table if not exists users (
  id uuid primary key,
  email citext unique,
  employee_id text unique,
  role text,
  full_name text,
  timezone text,
  active boolean,
  last_login_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  constraint users_id_fk foreign key (id) references auth.users(id),
  constraint users_role_chk check (role in ('admin', 'manager', 'instructor', 'staff'))
);

-- locations: Canonical agency location/program directory used for staffing, manager scope, requirements, and reporting.
-- soft delete: archived boolean + archived_at (never DELETE — history must survive)
create table if not exists locations (
  id uuid primary key,
  name text unique,
  program text,
  active boolean,
  archived boolean,
  archived_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);

-- managers: Manager and Area Coordinator identities used for location and supervision scope.
-- soft delete: active=false (never DELETE — history must survive)
create table if not exists managers (
  id uuid primary key,
  user_id uuid unique,
  employee_id text unique,
  name text,
  email citext,
  kind text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  constraint managers_user_id_fk foreign key (user_id) references users(id),
  constraint managers_kind_chk check (kind in ('manager', 'area_coordinator'))
);

-- staff: Authoritative staff directory synchronized from Intelex/HR sources without overwriting training history.
-- soft delete: archived boolean + archived_at (never DELETE — history must survive)
create table if not exists staff (
  id uuid primary key,
  user_id uuid unique,
  employee_id text unique,
  external_user_id text,
  first_name text,
  last_name text,
  full_name text,
  position_title text,
  role_bucket text,
  job_code text,
  employee_type text,
  company text,
  email citext,
  phone text,
  hire_date date,
  primary_location_id uuid,
  manager_id uuid,
  source_home_location text,
  source_login_location text,
  source_system text,
  source_updated_at timestamptz,
  active boolean,
  archived boolean,
  archived_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  constraint staff_user_id_fk foreign key (user_id) references users(id),
  constraint staff_primary_location_id_fk foreign key (primary_location_id) references locations(id),
  constraint staff_manager_id_fk foreign key (manager_id) references managers(id)
);

-- staff_location_assignments: Effective-dated multi-location staff assignments. One row may be marked primary.
-- soft delete: active=false + ended_at (never DELETE — history must survive)
create table if not exists staff_location_assignments (
  id uuid primary key,
  staff_id uuid,
  location_id uuid,
  is_primary boolean,
  active boolean,
  effective_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  constraint staff_location_assignments_staff_id_fk foreign key (staff_id) references staff(id),
  constraint staff_location_assignments_location_id_fk foreign key (location_id) references locations(id)
);
-- additional uniqueness: (staff_id, location_id, effective_at)

-- manager_location_assignments: Effective-dated manager access to one or more agency locations.
-- soft delete: active=false + ended_at (never DELETE — history must survive)
create table if not exists manager_location_assignments (
  id uuid primary key,
  manager_id uuid,
  location_id uuid,
  active boolean,
  effective_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  constraint manager_location_assignments_manager_id_fk foreign key (manager_id) references managers(id),
  constraint manager_location_assignments_location_id_fk foreign key (location_id) references locations(id)
);
-- additional uniqueness: (manager_id, location_id, effective_at)

-- manager_supervision_assignments: Area Coordinator to manager supervision hierarchy used to extend authorized scope.
-- soft delete: active=false + ended_at (never DELETE — history must survive)
create table if not exists manager_supervision_assignments (
  id uuid primary key,
  area_coordinator_id uuid,
  manager_id uuid,
  active boolean,
  effective_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  constraint manager_supervision_assignments_area_coordinator_id_fk foreign key (area_coordinator_id) references managers(id),
  constraint manager_supervision_assignments_manager_id_fk foreign key (manager_id) references managers(id)
);
-- additional uniqueness: (area_coordinator_id, manager_id, effective_at)

-- location_aliases: Reviewed source labels mapped to canonical LMS locations for recurring imports.
-- soft delete: active=false (never DELETE — history must survive)
create table if not exists location_aliases (
  id uuid primary key,
  normalized_alias text unique,
  display_alias text,
  location_id uuid,
  source_system text,
  active boolean,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  constraint location_aliases_location_id_fk foreign key (location_id) references locations(id),
  constraint location_aliases_created_by_fk foreign key (created_by) references users(id)
);

-- document_branding_settings: Central certificate/transcript/report branding configuration and logo pointer.
-- soft delete: active=false (never DELETE — history must survive)
create table if not exists document_branding_settings (
  id uuid primary key,
  key text unique,
  organization_name text,
  presented_by_text text,
  logo_storage_path text,
  logo_alt_text text,
  active boolean,
  updated_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  constraint document_branding_settings_updated_by_fk foreign key (updated_by) references users(id)
);

-- courses: Canonical course catalog across instructor-led, online, and blended delivery.
-- soft delete: active=false; historical records retained (never DELETE — history must survive)
create table if not exists courses (
  id uuid primary key,
  code text unique,
  title text,
  category text,
  delivery_type text,
  classification text,
  issue_certificate boolean,
  add_to_transcript boolean,
  counts_toward_compliance boolean,
  expiration_interval_months integer,
  one_time boolean,
  passing_score integer,
  current_version_number integer,
  active boolean,
  retired_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  constraint courses_delivery_type_chk check (delivery_type in ('in_person', 'live_virtual', 'online', 'blended')),
  constraint courses_classification_chk check (classification in ('mandatory', 'elective', 'professional_development', 'informational'))
);

-- course_requirements: Global requirement rules, due-date anchors, prerequisites, renewal cycles, and applicability.
-- soft delete: active=false (never DELETE — history must survive)
create table if not exists course_requirements (
  id uuid primary key,
  course_id uuid,
  applies_to text,
  location_id uuid,
  due_anchor text,
  due_offset_days integer,
  renewal_interval_days integer,
  grace_days integer,
  prerequisites jsonb,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  constraint course_requirements_course_id_fk foreign key (course_id) references courses(id),
  constraint course_requirements_location_id_fk foreign key (location_id) references locations(id),
  constraint course_requirements_due_anchor_chk check (due_anchor in ('hire_date', 'orientation_completion', 'sdch_completion', 'assignment_date', 'completion_date', 'manual'))
);

-- course_requirement_overrides: Effective-dated location/title/category overrides to global requirement rules.
-- soft delete: ended_at (never DELETE — history must survive)
create table if not exists course_requirement_overrides (
  id uuid primary key,
  requirement_id uuid,
  location_id uuid,
  position_pattern text,
  role_bucket text,
  required boolean,
  due_offset_days integer,
  renewal_interval_days integer,
  effective_at timestamptz,
  ended_at timestamptz,
  reason text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  constraint course_requirement_overrides_requirement_id_fk foreign key (requirement_id) references course_requirements(id),
  constraint course_requirement_overrides_location_id_fk foreign key (location_id) references locations(id),
  constraint course_requirement_overrides_created_by_fk foreign key (created_by) references users(id)
);

-- sessions: Scheduled course instances with controlled delivery/location values and custom-location support.
-- soft delete: status=cancelled (never DELETE — history must survive)
create table if not exists sessions (
  id uuid primary key,
  course_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  delivery_location text,
  custom_location text,
  display_location text,
  capacity integer,
  status text,
  certified_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  constraint sessions_course_id_fk foreign key (course_id) references courses(id),
  constraint sessions_delivery_location_chk check (delivery_location in ('zoom', 'online', 'blended', 'east_14th_street', 'other')),
  constraint sessions_status_chk check (status in ('draft', 'open', 'closed', 'in_progress', 'pending_certification', 'certified', 'locked', 'cancelled')),
  constraint sessions_created_by_fk foreign key (created_by) references users(id)
);

-- session_instructors: Lead and co-instructor assignments for each session.
-- soft delete: — (never DELETE — history must survive)
create table if not exists session_instructors (
  id uuid primary key,
  session_id uuid,
  instructor_user_id uuid,
  is_lead boolean,
  created_at timestamptz,
  updated_at timestamptz,
  constraint session_instructors_session_id_fk foreign key (session_id) references sessions(id),
  constraint session_instructors_instructor_user_id_fk foreign key (instructor_user_id) references users(id)
);
-- additional uniqueness: (session_id, instructor_user_id)

-- registration_requests: Role-scoped enrollment requests, approval decisions, waitlist outcomes, and idempotency.
-- soft delete: status lifecycle (never DELETE — history must survive)
create table if not exists registration_requests (
  id uuid primary key,
  staff_id uuid,
  session_id uuid,
  requested_by uuid,
  manager_id uuid,
  location_id uuid,
  status text,
  source text,
  decision_by uuid,
  decision_at timestamptz,
  reason text,
  metadata jsonb,
  idempotency_key text unique,
  created_at timestamptz,
  updated_at timestamptz,
  constraint registration_requests_staff_id_fk foreign key (staff_id) references staff(id),
  constraint registration_requests_session_id_fk foreign key (session_id) references sessions(id),
  constraint registration_requests_requested_by_fk foreign key (requested_by) references users(id),
  constraint registration_requests_manager_id_fk foreign key (manager_id) references managers(id),
  constraint registration_requests_location_id_fk foreign key (location_id) references locations(id),
  constraint registration_requests_status_chk check (status in ('pending_manager', 'pending_admin', 'approved', 'waitlisted', 'denied', 'cancelled', 'completed', 'no_show', 'failed')),
  constraint registration_requests_source_chk check (source in ('staff_request', 'manager_request', 'admin_registration', 'report_cell')),
  constraint registration_requests_decision_by_fk foreign key (decision_by) references users(id)
);
-- additional uniqueness: (staff_id, session_id) WHERE status IN ('pending_manager','pending_admin','approved','waitlisted')

-- session_rosters: Enrollment and waitlist membership for a session.
-- soft delete: status=cancelled (never DELETE — history must survive)
create table if not exists session_rosters (
  id uuid primary key,
  session_id uuid,
  staff_id uuid,
  registration_request_id uuid,
  status text,
  registered_by uuid,
  registered_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  constraint session_rosters_session_id_fk foreign key (session_id) references sessions(id),
  constraint session_rosters_staff_id_fk foreign key (staff_id) references staff(id),
  constraint session_rosters_registration_request_id_fk foreign key (registration_request_id) references registration_requests(id),
  constraint session_rosters_status_chk check (status in ('enrolled', 'waitlisted', 'cancelled', 'completed', 'no_show', 'failed')),
  constraint session_rosters_registered_by_fk foreign key (registered_by) references users(id)
);
-- additional uniqueness: (session_id, staff_id)

-- attendance_records: Per-learner attendance and result record, including certified-session corrections.
-- soft delete: — (never DELETE — history must survive)
create table if not exists attendance_records (
  id uuid primary key,
  session_id uuid,
  staff_id uuid,
  present boolean,
  result text,
  recorded_by uuid,
  recorded_at timestamptz,
  corrected_by uuid,
  corrected_at timestamptz,
  correction_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  constraint attendance_records_session_id_fk foreign key (session_id) references sessions(id),
  constraint attendance_records_staff_id_fk foreign key (staff_id) references staff(id),
  constraint attendance_records_result_chk check (result in ('pass', 'fail', 'absent', 'no_show')),
  constraint attendance_records_recorded_by_fk foreign key (recorded_by) references users(id),
  constraint attendance_records_corrected_by_fk foreign key (corrected_by) references users(id)
);
-- additional uniqueness: (session_id, staff_id)

-- external_certificates: Uploaded external credentials and approval lifecycle; accepted records can create completions.
-- soft delete: status lifecycle (never DELETE — history must survive)
create table if not exists external_certificates (
  id uuid primary key,
  staff_id uuid,
  course_id uuid,
  credential_type text,
  issuer text,
  issue_date date,
  expires_at date,
  storage_path text,
  status text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  constraint external_certificates_staff_id_fk foreign key (staff_id) references staff(id),
  constraint external_certificates_course_id_fk foreign key (course_id) references courses(id),
  constraint external_certificates_status_chk check (status in ('submitted', 'pending_review', 'approved', 'denied', 'expired', 'superseded', 'voided')),
  constraint external_certificates_reviewed_by_fk foreign key (reviewed_by) references users(id)
);

-- online_courses: Immutable online-course version records. The base course remains in courses.
-- soft delete: status=retired/deleted; immutable evidence retained (never DELETE — history must survive)
create table if not exists online_courses (
  id uuid primary key,
  course_id uuid,
  code text,
  version integer,
  status text,
  video_storage_path text,
  video_provider text,
  video_external_id text,
  required_watch_percent numeric(5,2),
  anti_skip_required boolean,
  quiz_required boolean,
  minimum_quiz_score integer,
  attestation_required boolean,
  acknowledgement_required boolean,
  final_submission_required boolean,
  issue_certificate boolean,
  add_to_transcript boolean,
  counts_toward_compliance boolean,
  classification text,
  change_summary text,
  revision_type text,
  published_at timestamptz,
  published_by uuid,
  retired_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  constraint online_courses_course_id_fk foreign key (course_id) references courses(id),
  constraint online_courses_status_chk check (status in ('draft', 'published', 'retired', 'deleted')),
  constraint online_courses_classification_chk check (classification in ('mandatory', 'elective', 'professional_development', 'informational')),
  constraint online_courses_revision_type_chk check (revision_type in ('minor', 'major')),
  constraint online_courses_published_by_fk foreign key (published_by) references users(id)
);
-- additional uniqueness: (course_id, version) · (code, version)

-- course_version_publications: Audit-grade record of a new version and its assignment migration policy/impact.
-- soft delete: — (never DELETE — history must survive)
create table if not exists course_version_publications (
  id uuid primary key,
  course_id uuid,
  from_version_id uuid,
  to_version_id uuid,
  policy text,
  not_started_moved integer,
  in_progress_retained integer,
  incomplete_replaced integer,
  completed_retrained integer,
  reason text,
  published_by uuid,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  constraint course_version_publications_course_id_fk foreign key (course_id) references courses(id),
  constraint course_version_publications_from_version_id_fk foreign key (from_version_id) references online_courses(id),
  constraint course_version_publications_to_version_id_fk foreign key (to_version_id) references online_courses(id),
  constraint course_version_publications_policy_chk check (policy in ('standard_update', 'new_assignments_only', 'replace_incomplete', 'retrain_all')),
  constraint course_version_publications_published_by_fk foreign key (published_by) references users(id)
);

-- course_modules: Ordered version-specific video, question, quiz, attestation, acknowledgement, and submission modules.
-- soft delete: — (never DELETE — history must survive)
create table if not exists course_modules (
  id uuid primary key,
  online_course_id uuid,
  position integer,
  type text,
  title text,
  required boolean,
  config jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  constraint course_modules_online_course_id_fk foreign key (online_course_id) references online_courses(id),
  constraint course_modules_type_chk check (type in ('video', 'embedded_question', 'quiz', 'attestation', 'acknowledgement', 'submission'))
);
-- additional uniqueness: (online_course_id, position)

-- course_assignments: Staff-course assignments pinned to an immutable online version and outcome settings snapshot.
-- soft delete: status=withdrawn/superseded (never DELETE — history must survive)
create table if not exists course_assignments (
  id uuid primary key,
  staff_id uuid,
  course_id uuid,
  online_course_id uuid,
  assigned_by uuid,
  assigned_at timestamptz,
  due_at timestamptz,
  started_at timestamptz,
  last_activity_at timestamptz,
  final_submission_at timestamptz,
  official_completion_at timestamptz,
  status text,
  progress_percent numeric(5,2),
  mandatory boolean,
  classification text,
  issue_certificate boolean,
  add_to_transcript boolean,
  counts_toward_compliance boolean,
  certificate_status text,
  transcript_status text,
  source text,
  idempotency_key text unique,
  withdrawn_at timestamptz,
  withdrawn_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  constraint course_assignments_staff_id_fk foreign key (staff_id) references staff(id),
  constraint course_assignments_course_id_fk foreign key (course_id) references courses(id),
  constraint course_assignments_online_course_id_fk foreign key (online_course_id) references online_courses(id),
  constraint course_assignments_assigned_by_fk foreign key (assigned_by) references users(id),
  constraint course_assignments_status_chk check (status in ('not_started', 'in_progress', 'submitted', 'completed', 'overdue', 'failed', 'exempt', 'voided', 'withdrawn', 'superseded')),
  constraint course_assignments_classification_chk check (classification in ('mandatory', 'elective', 'professional_development', 'informational')),
  constraint course_assignments_certificate_status_chk check (certificate_status in ('not_applicable', 'pending', 'generated', 'failed', 'voided')),
  constraint course_assignments_transcript_status_chk check (transcript_status in ('not_applicable', 'pending', 'posted', 'failed', 'voided')),
  constraint course_assignments_source_chk check (source in ('manual', 'auto_requirement', 'import', 'retraining', 'version_migration'))
);

-- course_module_progress: Authoritative completion state for every required module within an assignment.
-- soft delete: status=superseded (never DELETE — history must survive)
create table if not exists course_module_progress (
  id uuid primary key,
  assignment_id uuid,
  module_id uuid,
  status text,
  progress_percent numeric(5,2),
  started_at timestamptz,
  completed_at timestamptz,
  evidence jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  constraint course_module_progress_assignment_id_fk foreign key (assignment_id) references course_assignments(id),
  constraint course_module_progress_module_id_fk foreign key (module_id) references course_modules(id),
  constraint course_module_progress_status_chk check (status in ('not_started', 'in_progress', 'completed', 'failed', 'superseded'))
);
-- additional uniqueness: (assignment_id, module_id)

-- video_progress_events: Append-oriented watch heartbeats and validated watched intervals for anti-skip enforcement.
-- soft delete: — (never DELETE — history must survive)
create table if not exists video_progress_events (
  id uuid primary key,
  assignment_id uuid,
  module_id uuid,
  event_at timestamptz,
  from_second numeric(10,3),
  to_second numeric(10,3),
  position_second numeric(10,3),
  duration_seconds numeric(10,3),
  playback_rate numeric(4,2),
  client_event_id text unique,
  validated boolean,
  validation_reason text,
  client_metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  constraint video_progress_events_assignment_id_fk foreign key (assignment_id) references course_assignments(id),
  constraint video_progress_events_module_id_fk foreign key (module_id) references course_modules(id)
);

-- quiz_attempts: Server-graded quiz attempts pinned to assignment and version.
-- soft delete: — (never DELETE — history must survive)
create table if not exists quiz_attempts (
  id uuid primary key,
  assignment_id uuid,
  online_course_id uuid,
  attempt_number integer,
  answers jsonb,
  score numeric(5,2),
  passed boolean,
  submitted_at timestamptz,
  graded_at timestamptz,
  idempotency_key text unique,
  created_at timestamptz,
  updated_at timestamptz,
  constraint quiz_attempts_assignment_id_fk foreign key (assignment_id) references course_assignments(id),
  constraint quiz_attempts_online_course_id_fk foreign key (online_course_id) references online_courses(id)
);
-- additional uniqueness: (assignment_id, attempt_number)

-- attestations: Version-pinned attestation and required acknowledgement evidence.
-- soft delete: — (never DELETE — history must survive)
create table if not exists attestations (
  id uuid primary key,
  assignment_id uuid,
  online_course_id uuid,
  attestation_text text,
  response boolean,
  acknowledgements jsonb,
  attested_at timestamptz,
  ip_hash text,
  user_agent text,
  idempotency_key text unique,
  created_at timestamptz,
  updated_at timestamptz,
  constraint attestations_assignment_id_fk foreign key (assignment_id) references course_assignments(id),
  constraint attestations_online_course_id_fk foreign key (online_course_id) references online_courses(id)
);
-- additional uniqueness: (assignment_id)

-- course_completions: Authoritative, idempotent completion record used by compliance, certificates, and transcripts.
-- soft delete: voided boolean + reason; never hard-delete (never DELETE — history must survive)
create table if not exists course_completions (
  id uuid primary key,
  staff_id uuid,
  course_id uuid,
  online_course_id uuid,
  assignment_id uuid,
  session_id uuid,
  external_certificate_id uuid,
  completed_at timestamptz,
  official_completion_at timestamptz,
  expires_at timestamptz,
  source text,
  completion_origin text,
  retake_number integer,
  idempotency_key text unique,
  voided boolean,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  constraint course_completions_staff_id_fk foreign key (staff_id) references staff(id),
  constraint course_completions_course_id_fk foreign key (course_id) references courses(id),
  constraint course_completions_online_course_id_fk foreign key (online_course_id) references online_courses(id),
  constraint course_completions_assignment_id_fk foreign key (assignment_id) references course_assignments(id),
  constraint course_completions_session_id_fk foreign key (session_id) references sessions(id),
  constraint course_completions_external_certificate_id_fk foreign key (external_certificate_id) references external_certificates(id),
  constraint course_completions_source_chk check (source in ('in_person_session', 'online_course', 'independent', 'external_certificate', 'import', 'correction')),
  constraint course_completions_completion_origin_chk check (completion_origin in ('lms', 'manual', 'imported')),
  constraint course_completions_voided_by_fk foreign key (voided_by) references users(id)
);

-- completion_corrections: Before/after correction ledger for authoritative completions and certified attendance.
-- soft delete: — (never DELETE — history must survive)
create table if not exists completion_corrections (
  id uuid primary key,
  completion_id uuid,
  action text,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  performed_by uuid,
  performed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  constraint completion_corrections_completion_id_fk foreign key (completion_id) references course_completions(id),
  constraint completion_corrections_action_chk check (action in ('correct', 'void', 'restore')),
  constraint completion_corrections_performed_by_fk foreign key (performed_by) references users(id)
);

-- certificates: Certificate metadata linked one-way to a completion; generated documents live in private Storage.
-- soft delete: status=voided/superseded (never DELETE — history must survive)
create table if not exists certificates (
  id uuid primary key,
  completion_id uuid unique,
  staff_id uuid,
  course_id uuid,
  certificate_number text unique,
  status text,
  issued_at timestamptz,
  expires_at timestamptz,
  document_id uuid,
  verification_token text unique,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  constraint certificates_completion_id_fk foreign key (completion_id) references course_completions(id),
  constraint certificates_staff_id_fk foreign key (staff_id) references staff(id),
  constraint certificates_course_id_fk foreign key (course_id) references courses(id),
  constraint certificates_status_chk check (status in ('pending', 'generated', 'failed', 'voided', 'expired', 'superseded'))
);

-- transcript_entries: Immutable transcript posting record linked to the exact completion and course version.
-- soft delete: status=voided (never DELETE — history must survive)
create table if not exists transcript_entries (
  id uuid primary key,
  completion_id uuid unique,
  staff_id uuid,
  course_id uuid,
  online_course_id uuid,
  classification text,
  mandatory boolean,
  status text,
  posted_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  constraint transcript_entries_completion_id_fk foreign key (completion_id) references course_completions(id),
  constraint transcript_entries_staff_id_fk foreign key (staff_id) references staff(id),
  constraint transcript_entries_course_id_fk foreign key (course_id) references courses(id),
  constraint transcript_entries_online_course_id_fk foreign key (online_course_id) references online_courses(id),
  constraint transcript_entries_classification_chk check (classification in ('mandatory', 'elective', 'professional_development', 'informational')),
  constraint transcript_entries_status_chk check (status in ('pending', 'posted', 'failed', 'voided'))
);

-- generated_documents: Generated certificate, transcript, attendance sheet, report, and audit-packet metadata.
-- soft delete: expires_at / storage lifecycle (never DELETE — history must survive)
create table if not exists generated_documents (
  id uuid primary key,
  type text,
  staff_id uuid,
  session_id uuid,
  certificate_id uuid,
  scope jsonb,
  storage_bucket text,
  storage_path text,
  content_hash text,
  generated_by uuid,
  generated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  constraint generated_documents_type_chk check (type in ('certificate', 'transcript', 'attendance_sheet', 'report_export', 'audit_packet')),
  constraint generated_documents_staff_id_fk foreign key (staff_id) references staff(id),
  constraint generated_documents_session_id_fk foreign key (session_id) references sessions(id),
  constraint generated_documents_certificate_id_fk foreign key (certificate_id) references certificates(id),
  constraint generated_documents_generated_by_fk foreign key (generated_by) references users(id)
);

-- notification_jobs: Server-scheduled notification jobs with role scope and idempotency.
-- soft delete: status lifecycle (never DELETE — history must survive)
create table if not exists notification_jobs (
  id uuid primary key,
  type text,
  staff_id uuid,
  session_id uuid,
  assignment_id uuid,
  recipient_user_id uuid,
  channel text,
  send_at timestamptz,
  status text,
  template_key text,
  payload jsonb,
  idempotency_key text unique,
  attempts integer,
  last_error text,
  created_at timestamptz,
  updated_at timestamptz,
  constraint notification_jobs_staff_id_fk foreign key (staff_id) references staff(id),
  constraint notification_jobs_session_id_fk foreign key (session_id) references sessions(id),
  constraint notification_jobs_assignment_id_fk foreign key (assignment_id) references course_assignments(id),
  constraint notification_jobs_recipient_user_id_fk foreign key (recipient_user_id) references users(id),
  constraint notification_jobs_channel_chk check (channel in ('email', 'sms', 'in_app')),
  constraint notification_jobs_status_chk check (status in ('queued', 'processing', 'sent', 'failed', 'cancelled', 'suppressed'))
);

-- notification_logs: Immutable channel delivery receipt and communication history.
-- soft delete: — (never DELETE — history must survive)
create table if not exists notification_logs (
  id uuid primary key,
  job_id uuid,
  recipient_user_id uuid,
  channel text,
  provider_message_id text,
  status text,
  subject text,
  body_excerpt text,
  event_at timestamptz,
  provider_payload jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  constraint notification_logs_job_id_fk foreign key (job_id) references notification_jobs(id),
  constraint notification_logs_recipient_user_id_fk foreign key (recipient_user_id) references users(id),
  constraint notification_logs_channel_chk check (channel in ('email', 'sms', 'in_app')),
  constraint notification_logs_status_chk check (status in ('created', 'sent', 'delivered', 'failed', 'bounced', 'undelivered', 'opened', 'suppressed'))
);

-- report_templates: Saved report definitions, multi-location filters, columns, grouping, and sorting.
-- soft delete: active=false (never DELETE — history must survive)
create table if not exists report_templates (
  id uuid primary key,
  name text,
  owner_user_id uuid,
  scope_role text,
  report_type text,
  filters jsonb,
  columns jsonb,
  group_by text,
  sort_by text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  constraint report_templates_owner_user_id_fk foreign key (owner_user_id) references users(id),
  constraint report_templates_scope_role_chk check (scope_role in ('admin', 'manager'))
);

-- scheduled_reports: Recurring report definitions executed server-side.
-- soft delete: enabled=false (never DELETE — history must survive)
create table if not exists scheduled_reports (
  id uuid primary key,
  template_id uuid,
  owner_user_id uuid,
  recurrence text,
  timezone text,
  recipients jsonb,
  delivery_format text,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_key text,
  enabled boolean,
  created_at timestamptz,
  updated_at timestamptz,
  constraint scheduled_reports_template_id_fk foreign key (template_id) references report_templates(id),
  constraint scheduled_reports_owner_user_id_fk foreign key (owner_user_id) references users(id),
  constraint scheduled_reports_delivery_format_chk check (delivery_format in ('csv', 'xlsx', 'pdf'))
);

-- report_runs: Authoritative record of manual and scheduled filtered report generation/export.
-- soft delete: status lifecycle (never DELETE — history must survive)
create table if not exists report_runs (
  id uuid primary key,
  template_id uuid,
  scheduled_report_id uuid,
  requested_by uuid,
  scope jsonb,
  filters jsonb,
  row_count integer,
  format text,
  status text,
  idempotency_key text unique,
  document_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz,
  updated_at timestamptz,
  constraint report_runs_template_id_fk foreign key (template_id) references report_templates(id),
  constraint report_runs_scheduled_report_id_fk foreign key (scheduled_report_id) references scheduled_reports(id),
  constraint report_runs_requested_by_fk foreign key (requested_by) references users(id),
  constraint report_runs_format_chk check (format in ('csv', 'xlsx', 'pdf', 'print')),
  constraint report_runs_status_chk check (status in ('queued', 'running', 'completed', 'failed')),
  constraint report_runs_document_id_fk foreign key (document_id) references generated_documents(id)
);

-- import_batches: Recurring Intelex import batch metadata, source profile, preview totals, safety checks, and rollback snapshot.
-- soft delete: status lifecycle (never DELETE — history must survive)
create table if not exists import_batches (
  id uuid primary key,
  filename text,
  source_system text,
  source_profile text,
  file_hash text,
  uploaded_by uuid,
  status text,
  total_rows integer,
  source_active_rows integer,
  source_inactive_rows integer,
  ready_rows integer,
  blocked_rows integer,
  held_rows integer,
  skipped_historical_inactive integer,
  archive_missing_requested boolean,
  full_roster_eligible boolean,
  coverage_percent numeric(6,2),
  summary jsonb,
  rollback_snapshot jsonb,
  idempotency_key text unique,
  applied_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  constraint import_batches_source_profile_chk check (source_profile in ('intelex_active_staff', 'intelex_complete_directory', 'generic_staff_csv')),
  constraint import_batches_uploaded_by_fk foreign key (uploaded_by) references users(id),
  constraint import_batches_status_chk check (status in ('uploaded', 'previewed', 'needs_resolution', 'ready', 'applying', 'completed', 'failed', 'rolled_back'))
);

-- import_rows: Normalized row-by-row staff import staging, decisions, exact issue codes, and proposed changes.
-- soft delete: — (never DELETE — history must survive)
create table if not exists import_rows (
  id uuid primary key,
  batch_id uuid,
  row_number integer,
  employee_id text,
  source_active boolean,
  raw_row jsonb,
  normalized_row jsonb,
  decision text,
  issue_codes jsonb,
  proposed_changes jsonb,
  resolved_location_id uuid,
  target_staff_id uuid,
  ready boolean,
  created_at timestamptz,
  updated_at timestamptz,
  constraint import_rows_batch_id_fk foreign key (batch_id) references import_batches(id),
  constraint import_rows_decision_chk check (decision in ('create_active', 'update', 'reactivate', 'archive', 'unchanged', 'skip_historical_inactive', 'hold_incomplete_active', 'blocked', 'manual_skip')),
  constraint import_rows_resolved_location_id_fk foreign key (resolved_location_id) references locations(id),
  constraint import_rows_target_staff_id_fk foreign key (target_staff_id) references staff(id)
);
-- additional uniqueness: (batch_id, row_number)

-- import_resolutions: Administrator-entered manual fixes for held/blocked import rows, with before/after evidence.
-- soft delete: — (never DELETE — history must survive)
create table if not exists import_resolutions (
  id uuid primary key,
  batch_id uuid,
  row_id uuid,
  field_name text,
  previous_value jsonb,
  resolved_value jsonb,
  resolution_type text,
  reason text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  constraint import_resolutions_batch_id_fk foreign key (batch_id) references import_batches(id),
  constraint import_resolutions_row_id_fk foreign key (row_id) references import_rows(id),
  constraint import_resolutions_resolution_type_chk check (resolution_type in ('manual_value', 'mapped_location', 'mapped_role', 'skip_row', 'accepted_warning')),
  constraint import_resolutions_resolved_by_fk foreign key (resolved_by) references users(id)
);

-- audit_logs: Append-only, server-written audit trail with actor, entity, before/after values, reason, request, and correlation IDs.
-- soft delete: append-only; no update/delete (never DELETE — history must survive)
create table if not exists audit_logs (
  id uuid primary key,
  occurred_at timestamptz,
  actor_user_id uuid,
  actor_role text,
  event_type text,
  entity_type text,
  entity_id text,
  staff_id uuid,
  course_id uuid,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  severity text,
  request_id text,
  correlation_id text,
  ip_hash text,
  user_agent text,
  metadata jsonb,
  constraint audit_logs_actor_user_id_fk foreign key (actor_user_id) references users(id),
  constraint audit_logs_staff_id_fk foreign key (staff_id) references staff(id),
  constraint audit_logs_course_id_fk foreign key (course_id) references courses(id),
  constraint audit_logs_severity_chk check (severity in ('info', 'warning', 'compliance', 'critical'))
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
create index if not exists idx_users_email on users (email);
create index if not exists idx_users_employee_id on users (employee_id);
create index if not exists idx_users_role on users (role);
create index if not exists idx_users_active on users (active);
create index if not exists idx_locations_name on locations (name);
create index if not exists idx_locations_active on locations (active);
create index if not exists idx_locations_archived on locations (archived);
create index if not exists idx_managers_user_id on managers (user_id);
create index if not exists idx_managers_employee_id on managers (employee_id);
create index if not exists idx_managers_email on managers (email);
create index if not exists idx_managers_active on managers (active);
create index if not exists idx_staff_user_id on staff (user_id);
create index if not exists idx_staff_employee_id on staff (employee_id);
create index if not exists idx_staff_external_user_id on staff (external_user_id);
create index if not exists idx_staff_full_name on staff (full_name);
create index if not exists idx_staff_position_title on staff (position_title);
create index if not exists idx_staff_role_bucket on staff (role_bucket);
create index if not exists idx_staff_email on staff (email);
create index if not exists idx_staff_hire_date on staff (hire_date);
create index if not exists idx_staff_primary_location_id on staff (primary_location_id);
create index if not exists idx_staff_manager_id on staff (manager_id);
create index if not exists idx_staff_active on staff (active);
create index if not exists idx_staff_archived on staff (archived);
create index if not exists idx_staff_location_assignments_staff_id on staff_location_assignments (staff_id);
create index if not exists idx_staff_location_assignments_location_id on staff_location_assignments (location_id);
create index if not exists idx_staff_location_assignments_active on staff_location_assignments (active);
create index if not exists idx_manager_location_assignments_manager_id on manager_location_assignments (manager_id);
create index if not exists idx_manager_location_assignments_location_id on manager_location_assignments (location_id);
create index if not exists idx_manager_location_assignments_active on manager_location_assignments (active);
create index if not exists idx_manager_supervision_assignments_area_coordinator_id on manager_supervision_assignments (area_coordinator_id);
create index if not exists idx_manager_supervision_assignments_manager_id on manager_supervision_assignments (manager_id);
create index if not exists idx_location_aliases_normalized_alias on location_aliases (normalized_alias);
create index if not exists idx_location_aliases_location_id on location_aliases (location_id);
create index if not exists idx_courses_code on courses (code);
create index if not exists idx_courses_title on courses (title);
create index if not exists idx_courses_active on courses (active);
create index if not exists idx_course_requirements_course_id on course_requirements (course_id);
create index if not exists idx_course_requirements_applies_to on course_requirements (applies_to);
create index if not exists idx_course_requirements_location_id on course_requirements (location_id);
create index if not exists idx_course_requirement_overrides_requirement_id on course_requirement_overrides (requirement_id);
create index if not exists idx_course_requirement_overrides_location_id on course_requirement_overrides (location_id);
create index if not exists idx_sessions_course_id on sessions (course_id);
create index if not exists idx_sessions_starts_at on sessions (starts_at);
create index if not exists idx_sessions_status on sessions (status);
create index if not exists idx_session_instructors_session_id on session_instructors (session_id);
create index if not exists idx_session_instructors_instructor_user_id on session_instructors (instructor_user_id);
create index if not exists idx_registration_requests_staff_id on registration_requests (staff_id);
create index if not exists idx_registration_requests_session_id on registration_requests (session_id);
create index if not exists idx_registration_requests_requested_by on registration_requests (requested_by);
create index if not exists idx_registration_requests_manager_id on registration_requests (manager_id);
create index if not exists idx_registration_requests_location_id on registration_requests (location_id);
create index if not exists idx_registration_requests_status on registration_requests (status);
create index if not exists idx_registration_requests_idempotency_key on registration_requests (idempotency_key);
create index if not exists idx_session_rosters_session_id on session_rosters (session_id);
create index if not exists idx_session_rosters_staff_id on session_rosters (staff_id);
create index if not exists idx_session_rosters_status on session_rosters (status);
create index if not exists idx_attendance_records_session_id on attendance_records (session_id);
create index if not exists idx_attendance_records_staff_id on attendance_records (staff_id);
create index if not exists idx_attendance_records_result on attendance_records (result);
create index if not exists idx_external_certificates_staff_id on external_certificates (staff_id);
create index if not exists idx_external_certificates_course_id on external_certificates (course_id);
create index if not exists idx_external_certificates_expires_at on external_certificates (expires_at);
create index if not exists idx_external_certificates_status on external_certificates (status);
create index if not exists idx_online_courses_course_id on online_courses (course_id);
create index if not exists idx_online_courses_code on online_courses (code);
create index if not exists idx_online_courses_version on online_courses (version);
create index if not exists idx_online_courses_status on online_courses (status);
create index if not exists idx_course_version_publications_course_id on course_version_publications (course_id);
create index if not exists idx_course_version_publications_to_version_id on course_version_publications (to_version_id);
create index if not exists idx_course_modules_online_course_id on course_modules (online_course_id);
create index if not exists idx_course_assignments_staff_id on course_assignments (staff_id);
create index if not exists idx_course_assignments_course_id on course_assignments (course_id);
create index if not exists idx_course_assignments_online_course_id on course_assignments (online_course_id);
create index if not exists idx_course_assignments_assigned_at on course_assignments (assigned_at);
create index if not exists idx_course_assignments_due_at on course_assignments (due_at);
create index if not exists idx_course_assignments_final_submission_at on course_assignments (final_submission_at);
create index if not exists idx_course_assignments_official_completion_at on course_assignments (official_completion_at);
create index if not exists idx_course_assignments_status on course_assignments (status);
create index if not exists idx_course_assignments_progress_percent on course_assignments (progress_percent);
create index if not exists idx_course_assignments_certificate_status on course_assignments (certificate_status);
create index if not exists idx_course_assignments_transcript_status on course_assignments (transcript_status);
create index if not exists idx_course_assignments_idempotency_key on course_assignments (idempotency_key);
create index if not exists idx_course_module_progress_assignment_id on course_module_progress (assignment_id);
create index if not exists idx_course_module_progress_module_id on course_module_progress (module_id);
create index if not exists idx_video_progress_events_assignment_id on video_progress_events (assignment_id);
create index if not exists idx_video_progress_events_module_id on video_progress_events (module_id);
create index if not exists idx_video_progress_events_event_at on video_progress_events (event_at);
create index if not exists idx_video_progress_events_client_event_id on video_progress_events (client_event_id);
create index if not exists idx_video_progress_events_validated on video_progress_events (validated);
create index if not exists idx_quiz_attempts_assignment_id on quiz_attempts (assignment_id);
create index if not exists idx_quiz_attempts_online_course_id on quiz_attempts (online_course_id);
create index if not exists idx_quiz_attempts_passed on quiz_attempts (passed);
create index if not exists idx_quiz_attempts_idempotency_key on quiz_attempts (idempotency_key);
create index if not exists idx_attestations_assignment_id on attestations (assignment_id);
create index if not exists idx_attestations_online_course_id on attestations (online_course_id);
create index if not exists idx_attestations_idempotency_key on attestations (idempotency_key);
create index if not exists idx_course_completions_staff_id on course_completions (staff_id);
create index if not exists idx_course_completions_course_id on course_completions (course_id);
create index if not exists idx_course_completions_online_course_id on course_completions (online_course_id);
create index if not exists idx_course_completions_assignment_id on course_completions (assignment_id);
create index if not exists idx_course_completions_session_id on course_completions (session_id);
create index if not exists idx_course_completions_completed_at on course_completions (completed_at);
create index if not exists idx_course_completions_official_completion_at on course_completions (official_completion_at);
create index if not exists idx_course_completions_expires_at on course_completions (expires_at);
create index if not exists idx_course_completions_source on course_completions (source);
create index if not exists idx_course_completions_idempotency_key on course_completions (idempotency_key);
create index if not exists idx_course_completions_voided on course_completions (voided);
create index if not exists idx_completion_corrections_completion_id on completion_corrections (completion_id);
create index if not exists idx_certificates_completion_id on certificates (completion_id);
create index if not exists idx_certificates_staff_id on certificates (staff_id);
create index if not exists idx_certificates_course_id on certificates (course_id);
create index if not exists idx_certificates_certificate_number on certificates (certificate_number);
create index if not exists idx_certificates_status on certificates (status);
create index if not exists idx_certificates_verification_token on certificates (verification_token);
create index if not exists idx_transcript_entries_completion_id on transcript_entries (completion_id);
create index if not exists idx_transcript_entries_staff_id on transcript_entries (staff_id);
create index if not exists idx_transcript_entries_course_id on transcript_entries (course_id);
create index if not exists idx_transcript_entries_status on transcript_entries (status);
create index if not exists idx_generated_documents_type on generated_documents (type);
create index if not exists idx_generated_documents_staff_id on generated_documents (staff_id);
create index if not exists idx_generated_documents_session_id on generated_documents (session_id);
create index if not exists idx_generated_documents_generated_by on generated_documents (generated_by);
create index if not exists idx_generated_documents_generated_at on generated_documents (generated_at);
create index if not exists idx_notification_jobs_type on notification_jobs (type);
create index if not exists idx_notification_jobs_staff_id on notification_jobs (staff_id);
create index if not exists idx_notification_jobs_session_id on notification_jobs (session_id);
create index if not exists idx_notification_jobs_assignment_id on notification_jobs (assignment_id);
create index if not exists idx_notification_jobs_recipient_user_id on notification_jobs (recipient_user_id);
create index if not exists idx_notification_jobs_send_at on notification_jobs (send_at);
create index if not exists idx_notification_jobs_status on notification_jobs (status);
create index if not exists idx_notification_jobs_idempotency_key on notification_jobs (idempotency_key);
create index if not exists idx_notification_logs_job_id on notification_logs (job_id);
create index if not exists idx_notification_logs_recipient_user_id on notification_logs (recipient_user_id);
create index if not exists idx_notification_logs_provider_message_id on notification_logs (provider_message_id);
create index if not exists idx_notification_logs_status on notification_logs (status);
create index if not exists idx_notification_logs_event_at on notification_logs (event_at);
create index if not exists idx_report_templates_name on report_templates (name);
create index if not exists idx_report_templates_owner_user_id on report_templates (owner_user_id);
create index if not exists idx_scheduled_reports_template_id on scheduled_reports (template_id);
create index if not exists idx_scheduled_reports_owner_user_id on scheduled_reports (owner_user_id);
create index if not exists idx_scheduled_reports_next_run_at on scheduled_reports (next_run_at);
create index if not exists idx_scheduled_reports_last_run_key on scheduled_reports (last_run_key);
create index if not exists idx_scheduled_reports_enabled on scheduled_reports (enabled);
create index if not exists idx_report_runs_template_id on report_runs (template_id);
create index if not exists idx_report_runs_scheduled_report_id on report_runs (scheduled_report_id);
create index if not exists idx_report_runs_requested_by on report_runs (requested_by);
create index if not exists idx_report_runs_status on report_runs (status);
create index if not exists idx_report_runs_idempotency_key on report_runs (idempotency_key);
create index if not exists idx_import_batches_file_hash on import_batches (file_hash);
create index if not exists idx_import_batches_uploaded_by on import_batches (uploaded_by);
create index if not exists idx_import_batches_status on import_batches (status);
create index if not exists idx_import_batches_idempotency_key on import_batches (idempotency_key);
create index if not exists idx_import_rows_batch_id on import_rows (batch_id);
create index if not exists idx_import_rows_employee_id on import_rows (employee_id);
create index if not exists idx_import_rows_decision on import_rows (decision);
create index if not exists idx_import_rows_resolved_location_id on import_rows (resolved_location_id);
create index if not exists idx_import_rows_target_staff_id on import_rows (target_staff_id);
create index if not exists idx_import_rows_ready on import_rows (ready);
create index if not exists idx_import_resolutions_batch_id on import_resolutions (batch_id);
create index if not exists idx_import_resolutions_row_id on import_resolutions (row_id);
create index if not exists idx_audit_logs_occurred_at on audit_logs (occurred_at);
create index if not exists idx_audit_logs_actor_user_id on audit_logs (actor_user_id);
create index if not exists idx_audit_logs_actor_role on audit_logs (actor_role);
create index if not exists idx_audit_logs_event_type on audit_logs (event_type);
create index if not exists idx_audit_logs_entity_type on audit_logs (entity_type);
create index if not exists idx_audit_logs_entity_id on audit_logs (entity_id);
create index if not exists idx_audit_logs_staff_id on audit_logs (staff_id);
create index if not exists idx_audit_logs_course_id on audit_logs (course_id);
create index if not exists idx_audit_logs_severity on audit_logs (severity);
create index if not exists idx_audit_logs_request_id on audit_logs (request_id);
create index if not exists idx_audit_logs_correlation_id on audit_logs (correlation_id);

-- ---------------------------------------------------------------------
-- Row Level Security
-- Every table is denied by default, then opened per role. The browser-side
-- checks in this application are UX guards; these policies are the boundary.
-- ---------------------------------------------------------------------
alter table users enable row level security;
alter table locations enable row level security;
alter table managers enable row level security;
alter table staff enable row level security;
alter table staff_location_assignments enable row level security;
alter table manager_location_assignments enable row level security;
alter table manager_supervision_assignments enable row level security;
alter table location_aliases enable row level security;
alter table document_branding_settings enable row level security;
alter table courses enable row level security;
alter table course_requirements enable row level security;
alter table course_requirement_overrides enable row level security;
alter table sessions enable row level security;
alter table session_instructors enable row level security;
alter table registration_requests enable row level security;
alter table session_rosters enable row level security;
alter table attendance_records enable row level security;
alter table external_certificates enable row level security;
alter table online_courses enable row level security;
alter table course_version_publications enable row level security;
alter table course_modules enable row level security;
alter table course_assignments enable row level security;
alter table course_module_progress enable row level security;
alter table video_progress_events enable row level security;
alter table quiz_attempts enable row level security;
alter table attestations enable row level security;
alter table course_completions enable row level security;
alter table completion_corrections enable row level security;
alter table certificates enable row level security;
alter table transcript_entries enable row level security;
alter table generated_documents enable row level security;
alter table notification_jobs enable row level security;
alter table notification_logs enable row level security;
alter table report_templates enable row level security;
alter table scheduled_reports enable row level security;
alter table report_runs enable row level security;
alter table import_batches enable row level security;
alter table import_rows enable row level security;
alter table import_resolutions enable row level security;
alter table audit_logs enable row level security;

-- users
create policy users_admin_select on users for select to authenticated using (hasc_current_role() = 'admin');
create policy users_admin_write on users for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
create policy users_manager_select on users for select to authenticated using (hasc_current_role() = 'manager' and (auth.uid()=id));
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Self · Insert: No · Update: Self profile only · Delete: No ]  instructor [ Select: Self · Insert: No · Update: Self profile only · Delete: No ]  staff [ Select: Self · Insert: No · Update: Self profile only · Delete: No ]

-- locations
create policy locations_admin_select on locations for select to authenticated using (hasc_current_role() = 'admin');
create policy locations_admin_write on locations for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized/reference rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Reference rows · Insert: No · Update: No · Delete: No ]  staff [ Select: Published/active rows · Insert: No · Update: No · Delete: No ]

-- managers
create policy managers_admin_select on managers for select to authenticated using (hasc_current_role() = 'admin');
create policy managers_admin_write on managers for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
create policy managers_manager_select on managers for select to authenticated using (hasc_current_role() = 'manager' and (current_manager_id()));
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Self + supervised managers · Insert: No · Update: Self contact only · Delete: No ]  instructor [ Select: Assigned session instructors only · Insert: No · Update: No · Delete: No ]  staff [ Select: No · Insert: No · Update: No · Delete: No ]

-- staff
create policy staff_admin_select on staff for select to authenticated using (hasc_current_role() = 'admin');
create policy staff_admin_write on staff for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
create policy staff_manager_select on staff for select to authenticated using (hasc_current_role() = 'manager' and (staff.id IN manager_staff_scope()));
-- TODO(policy): staff / instructor select scope is documented as prose, not SQL:
--   "staff assigned to instructor sessions"
-- create policy staff_instructor_select on staff for select to authenticated using (hasc_current_role() = 'instructor' and <predicate>);
create policy staff_staff_select on staff for select to authenticated using (hasc_current_role() = 'staff' and (staff.user_id=auth.uid()));
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff · Insert: No · Update: No · Delete: No ]  instructor [ Select: Session roster staff · Insert: No · Update: No · Delete: No ]  staff [ Select: Self · Insert: No · Update: No · Delete: No ]

-- staff_location_assignments
create policy staff_location_assignments_admin_select on staff_location_assignments for select to authenticated using (hasc_current_role() = 'admin');
create policy staff_location_assignments_admin_write on staff_location_assignments for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
create policy staff_location_assignments_manager_select on staff_location_assignments for select to authenticated using (hasc_current_role() = 'manager' and (staff_id IN manager_staff_scope()));
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Session roster staff rows · Insert: No · Update: No · Delete: No ]  staff [ Select: Self rows · Insert: No · Update: No · Delete: No ]

-- manager_location_assignments
create policy manager_location_assignments_admin_select on manager_location_assignments for select to authenticated using (hasc_current_role() = 'admin');
create policy manager_location_assignments_admin_write on manager_location_assignments for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
create policy manager_location_assignments_manager_select on manager_location_assignments for select to authenticated using (hasc_current_role() = 'manager' and (current_manager_id()));
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Own scope rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: No · Insert: No · Update: No · Delete: No ]

-- manager_supervision_assignments
create policy manager_supervision_assignments_admin_select on manager_supervision_assignments for select to authenticated using (hasc_current_role() = 'admin');
create policy manager_supervision_assignments_admin_write on manager_supervision_assignments for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
create policy manager_supervision_assignments_manager_select on manager_supervision_assignments for select to authenticated using (hasc_current_role() = 'manager' and (current_manager_id()));
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Own scope rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: No · Insert: No · Update: No · Delete: No ]

-- location_aliases
create policy location_aliases_admin_select on location_aliases for select to authenticated using (hasc_current_role() = 'admin');
create policy location_aliases_admin_write on location_aliases for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Active aliases · Insert: No · Update: No · Delete: No ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: No · Insert: No · Update: No · Delete: No ]

-- document_branding_settings
create policy document_branding_settings_admin_select on document_branding_settings for select to authenticated using (hasc_current_role() = 'admin');
create policy document_branding_settings_admin_write on document_branding_settings for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized/reference rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Reference rows · Insert: No · Update: No · Delete: No ]  staff [ Select: Published/active rows · Insert: No · Update: No · Delete: No ]

-- courses
create policy courses_admin_select on courses for select to authenticated using (hasc_current_role() = 'admin');
create policy courses_admin_write on courses for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized/reference rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Reference rows · Insert: No · Update: No · Delete: No ]  staff [ Select: Published/active rows · Insert: No · Update: No · Delete: No ]

-- course_requirements
create policy course_requirements_admin_select on course_requirements for select to authenticated using (hasc_current_role() = 'admin');
create policy course_requirements_admin_write on course_requirements for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized/reference rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Reference rows · Insert: No · Update: No · Delete: No ]  staff [ Select: Published/active rows · Insert: No · Update: No · Delete: No ]

-- course_requirement_overrides
create policy course_requirement_overrides_admin_select on course_requirement_overrides for select to authenticated using (hasc_current_role() = 'admin');
create policy course_requirement_overrides_admin_write on course_requirement_overrides for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized/reference rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Reference rows · Insert: No · Update: No · Delete: No ]  staff [ Select: Published/active rows · Insert: No · Update: No · Delete: No ]

-- sessions
create policy sessions_admin_select on sessions for select to authenticated using (hasc_current_role() = 'admin');
create policy sessions_admin_write on sessions for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized/open sessions · Insert: No · Update: No · Delete: No ]  instructor [ Select: Assigned sessions · Insert: No · Update: Limited via RPC · Delete: No ]  staff [ Select: Open/future sessions · Insert: No · Update: No · Delete: No ]

-- session_instructors
create policy session_instructors_admin_select on session_instructors for select to authenticated using (hasc_current_role() = 'admin');
create policy session_instructors_admin_write on session_instructors for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized session rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Own assignments · Insert: No · Update: No · Delete: No ]  staff [ Select: Open session instructor names · Insert: No · Update: No · Delete: No ]

-- registration_requests
create policy registration_requests_admin_select on registration_requests for select to authenticated using (hasc_current_role() = 'admin');
create policy registration_requests_admin_write on registration_requests for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
create policy registration_requests_manager_select on registration_requests for select to authenticated using (hasc_current_role() = 'manager' and (staff_id IN manager_staff_scope()));
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff requests · Insert: Authorized staff via RPC · Update: No direct update · Delete: No ]  instructor [ Select: Own session requests · Insert: No · Update: No · Delete: No ]  staff [ Select: Self · Insert: Self via RPC · Update: Cancel own pending via RPC · Delete: No ]

-- session_rosters
create policy session_rosters_admin_select on session_rosters for select to authenticated using (hasc_current_role() = 'admin');
create policy session_rosters_admin_write on session_rosters for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Assigned sessions · Insert: No · Update: No · Delete: No ]  staff [ Select: Self · Insert: No · Update: No · Delete: No ]

-- attendance_records
create policy attendance_records_admin_select on attendance_records for select to authenticated using (hasc_current_role() = 'admin');
create policy attendance_records_admin_write on attendance_records for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Assigned sessions · Insert: Assigned sessions via RPC · Update: Assigned sessions via RPC · Delete: No ]  staff [ Select: Self after session · Insert: No · Update: No · Delete: No ]

-- external_certificates
create policy external_certificates_admin_select on external_certificates for select to authenticated using (hasc_current_role() = 'admin');
create policy external_certificates_admin_write on external_certificates for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff rows · Insert: Authorized staff submissions · Update: No · Delete: No ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: Self · Insert: Self submit · Update: No direct update · Delete: No ]

-- online_courses
create policy online_courses_admin_select on online_courses for select to authenticated using (hasc_current_role() = 'admin');
create policy online_courses_admin_write on online_courses for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized/reference rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Reference rows · Insert: No · Update: No · Delete: No ]  staff [ Select: Published/active rows · Insert: No · Update: No · Delete: No ]

-- course_version_publications
create policy course_version_publications_admin_select on course_version_publications for select to authenticated using (hasc_current_role() = 'admin');
create policy course_version_publications_admin_write on course_version_publications for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: No · Insert: No · Update: No · Delete: No ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: No · Insert: No · Update: No · Delete: No ]

-- course_modules
create policy course_modules_admin_select on course_modules for select to authenticated using (hasc_current_role() = 'admin');
create policy course_modules_admin_write on course_modules for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized/reference rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Reference rows · Insert: No · Update: No · Delete: No ]  staff [ Select: Published/active rows · Insert: No · Update: No · Delete: No ]

-- course_assignments
create policy course_assignments_admin_select on course_assignments for select to authenticated using (hasc_current_role() = 'admin');
create policy course_assignments_admin_write on course_assignments for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Session-linked evidence only · Insert: No · Update: No · Delete: No ]  staff [ Select: Self · Insert: Self evidence via RPC/insert · Update: Self limited via RPC · Delete: No ]

-- course_module_progress
create policy course_module_progress_admin_select on course_module_progress for select to authenticated using (hasc_current_role() = 'admin');
create policy course_module_progress_admin_write on course_module_progress for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Session-linked evidence only · Insert: No · Update: No · Delete: No ]  staff [ Select: Self · Insert: Self evidence via RPC/insert · Update: Self limited via RPC · Delete: No ]

-- video_progress_events
create policy video_progress_events_admin_select on video_progress_events for select to authenticated using (hasc_current_role() = 'admin');
create policy video_progress_events_admin_write on video_progress_events for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Session-linked evidence only · Insert: No · Update: No · Delete: No ]  staff [ Select: Self · Insert: Self evidence via RPC/insert · Update: Self limited via RPC · Delete: No ]

-- quiz_attempts
create policy quiz_attempts_admin_select on quiz_attempts for select to authenticated using (hasc_current_role() = 'admin');
create policy quiz_attempts_admin_write on quiz_attempts for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Session-linked evidence only · Insert: No · Update: No · Delete: No ]  staff [ Select: Self · Insert: Self evidence via RPC/insert · Update: Self limited via RPC · Delete: No ]

-- attestations
create policy attestations_admin_select on attestations for select to authenticated using (hasc_current_role() = 'admin');
create policy attestations_admin_write on attestations for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Session-linked evidence only · Insert: No · Update: No · Delete: No ]  staff [ Select: Self · Insert: Self evidence via RPC/insert · Update: Self limited via RPC · Delete: No ]

-- course_completions
create policy course_completions_admin_select on course_completions for select to authenticated using (hasc_current_role() = 'admin');
create policy course_completions_admin_write on course_completions for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Own certified sessions where applicable · Insert: No · Update: No · Delete: No ]  staff [ Select: Self · Insert: No · Update: No · Delete: No ]

-- completion_corrections
create policy completion_corrections_admin_select on completion_corrections for select to authenticated using (hasc_current_role() = 'admin');
create policy completion_corrections_admin_write on completion_corrections for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: No · Insert: No · Update: No · Delete: No ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: No · Insert: No · Update: No · Delete: No ]

-- certificates
create policy certificates_admin_select on certificates for select to authenticated using (hasc_current_role() = 'admin');
create policy certificates_admin_write on certificates for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Own certified sessions where applicable · Insert: No · Update: No · Delete: No ]  staff [ Select: Self · Insert: No · Update: No · Delete: No ]

-- transcript_entries
create policy transcript_entries_admin_select on transcript_entries for select to authenticated using (hasc_current_role() = 'admin');
create policy transcript_entries_admin_write on transcript_entries for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Own certified sessions where applicable · Insert: No · Update: No · Delete: No ]  staff [ Select: Self · Insert: No · Update: No · Delete: No ]

-- generated_documents
create policy generated_documents_admin_select on generated_documents for select to authenticated using (hasc_current_role() = 'admin');
create policy generated_documents_admin_write on generated_documents for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized staff rows · Insert: No · Update: No · Delete: No ]  instructor [ Select: Own certified sessions where applicable · Insert: No · Update: No · Delete: No ]  staff [ Select: Self · Insert: No · Update: No · Delete: No ]

-- notification_jobs
create policy notification_jobs_admin_select on notification_jobs for select to authenticated using (hasc_current_role() = 'admin');
create policy notification_jobs_admin_write on notification_jobs for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized recipient/staff jobs · Insert: No · Update: No · Delete: No ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: Recipient in-app jobs · Insert: No · Update: No · Delete: No ]

-- notification_logs
create policy notification_logs_admin_select on notification_logs for select to authenticated using (hasc_current_role() = 'admin');
create policy notification_logs_admin_write on notification_logs for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Authorized recipient/staff logs · Insert: No · Update: No · Delete: No ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: Recipient logs · Insert: No · Update: No · Delete: No ]

-- report_templates
create policy report_templates_admin_select on report_templates for select to authenticated using (hasc_current_role() = 'admin');
create policy report_templates_admin_write on report_templates for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Own templates · Insert: Own · Update: Own · Delete: Own ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: No · Insert: No · Update: No · Delete: No ]

-- scheduled_reports
create policy scheduled_reports_admin_select on scheduled_reports for select to authenticated using (hasc_current_role() = 'admin');
create policy scheduled_reports_admin_write on scheduled_reports for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Own role-scoped records · Insert: Own via RPC · Update: Own via RPC · Delete: Own via RPC ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: No · Insert: No · Update: No · Delete: No ]

-- report_runs
create policy report_runs_admin_select on report_runs for select to authenticated using (hasc_current_role() = 'admin');
create policy report_runs_admin_write on report_runs for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: Own role-scoped records · Insert: Own via RPC · Update: Own via RPC · Delete: Own via RPC ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: No · Insert: No · Update: No · Delete: No ]

-- import_batches
create policy import_batches_admin_select on import_batches for select to authenticated using (hasc_current_role() = 'admin');
create policy import_batches_admin_write on import_batches for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: No · Insert: No · Update: No · Delete: No ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: No · Insert: No · Update: No · Delete: No ]

-- import_rows
create policy import_rows_admin_select on import_rows for select to authenticated using (hasc_current_role() = 'admin');
create policy import_rows_admin_write on import_rows for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: No · Insert: No · Update: No · Delete: No ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: No · Insert: No · Update: No · Delete: No ]

-- import_resolutions
create policy import_resolutions_admin_select on import_resolutions for select to authenticated using (hasc_current_role() = 'admin');
create policy import_resolutions_admin_write on import_resolutions for all to authenticated using (hasc_current_role() = 'admin') with check (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: All · Update: All · Delete: All ]  manager [ Select: No · Insert: No · Update: No · Delete: No ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: No · Insert: No · Update: No · Delete: No ]

-- audit_logs
create policy audit_logs_admin_select on audit_logs for select to authenticated using (hasc_current_role() = 'admin');
-- grants: admin [ Select: All · Insert: No client insert · Update: No · Delete: No ]  manager [ Select: No · Insert: No · Update: No · Delete: No ]  instructor [ Select: No · Insert: No · Update: No · Delete: No ]  staff [ Select: No · Insert: No · Update: No · Delete: No ]

-- ---------------------------------------------------------------------
-- Storage buckets (private; access brokered by signed URLs only)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('branding-assets', 'branding-assets', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('course-videos', 'course-videos', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('course-assets', 'course-assets', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('external-certificates', 'external-certificates', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('generated-certificates', 'generated-certificates', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('transcripts', 'transcripts', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('attendance-sheets', 'attendance-sheets', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('report-exports', 'report-exports', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('staff-imports', 'staff-imports', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('audit-packets', 'audit-packets', false) on conflict (id) do nothing;

-- =====================================================================
-- RPC CONTRACTS — write these before going live
--
-- Each of these is read-then-write in the browser. That is correct in a
-- single-threaded page and WRONG against Postgres, where two callers can
-- both pass the check. They must not be ported as client round-trips.
-- =====================================================================
-- register_staff_for_session(p_session_id uuid, p_staff_ids uuid[], p_override_reason text)
--   Capacity is evaluated then written. Two managers can both see the last seat. Take a row lock on sessions, re-count inside the transaction, and return per-staff accepted/rejected.

-- certify_session(p_session_id uuid)
--   Writes attendance results, posts one completion per passing attendee, updates registration statuses and locks the session. Four tables — one transaction, or a failure leaves a half-certified session. Must be idempotent: a second call posts nothing.

-- void_completion(p_completion_id uuid, p_reason text)
--   Append-only. Insert into completion_voids and recompute compliance; never DELETE the completion row.

-- apply_staff_import(p_batch_id uuid)
--   Creates, updates, archives and reactivates staff in one transaction with a full rollback, and closes out future registrations, reminders and assignments for archived staff.

-- recalculate_compliance(p_staff_ids uuid[])
--   Compliance is computed in the browser today over roughly 4k staff x 26 courses. Server-side this is a materialized view refreshed by this function, or every dashboard ships the whole roster to the client.

-- End of generated schema.