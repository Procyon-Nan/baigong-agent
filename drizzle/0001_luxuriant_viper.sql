CREATE TABLE "security_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" text,
	"actor_source" varchar(24) NOT NULL,
	"action" varchar(80) NOT NULL,
	"target_type" varchar(40) NOT NULL,
	"target_id" text,
	"outcome" varchar(16) NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(254) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"username" varchar(64),
	"display_username" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_users_email_normalized" CHECK ("auth_users"."email" = lower(btrim("auth_users"."email"))),
	CONSTRAINT "auth_users_username_normalized" CHECK ("auth_users"."username" IS NULL OR "auth_users"."username" = lower(btrim("auth_users"."username")))
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedded_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"secret_hash" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"allowed_origins" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "embedded_clients_status_allowed" CHECK ("embedded_clients"."status" IN ('ACTIVE', 'DISABLED', 'DELETED'))
);
--> statement-breakpoint
CREATE TABLE "embedded_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"integration_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" varchar(120) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedded_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_digest" varchar(64) NOT NULL,
	"integration_id" uuid NOT NULL,
	"external_user_id" varchar(255) NOT NULL,
	"origin" text NOT NULL,
	"agent_id" varchar(120) NOT NULL,
	"jti" uuid NOT NULL,
	"display_name" varchar(120),
	"display_email" varchar(254),
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_identities" (
	"integration_id" uuid NOT NULL,
	"external_user_id" varchar(255) NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_identities_integration_id_external_user_id_pk" PRIMARY KEY("integration_id","external_user_id")
);
--> statement-breakpoint
CREATE TABLE "login_identifier_failures" (
	"identifier_hash" varchar(64) PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"failure_count" integer NOT NULL,
	"restricted_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_source_limits" (
	"source_hash" varchar(64) PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" varchar(16) NOT NULL,
	"role" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"display_email" varchar(254),
	"must_change_password" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_source_allowed" CHECK ("user_profiles"."source" IN ('LOCAL', 'EMBEDDED')),
	CONSTRAINT "user_profiles_role_allowed" CHECK ("user_profiles"."role" IN ('USER', 'ADMIN')),
	CONSTRAINT "user_profiles_status_allowed" CHECK ("user_profiles"."status" IN ('ACTIVE', 'DISABLED')),
	CONSTRAINT "user_profiles_embedded_role" CHECK ("user_profiles"."source" <> 'EMBEDDED' OR "user_profiles"."role" = 'USER'),
	CONSTRAINT "user_profiles_embedded_password_flag" CHECK ("user_profiles"."source" <> 'EMBEDDED' OR "user_profiles"."must_change_password" = false)
);
--> statement-breakpoint
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_actor_user_id_auth_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedded_clients" ADD CONSTRAINT "embedded_clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedded_sessions" ADD CONSTRAINT "embedded_sessions_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedded_sessions" ADD CONSTRAINT "embedded_sessions_integration_id_embedded_clients_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."embedded_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedded_sessions" ADD CONSTRAINT "embedded_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedded_tickets" ADD CONSTRAINT "embedded_tickets_integration_id_embedded_clients_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."embedded_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_integration_id_embedded_clients_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."embedded_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_audit_tenant_time_index" ON "security_audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "security_audit_action_time_index" ON "security_audit_events" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_index" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_account_unique" ON "auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_limits_key_unique" ON "auth_rate_limits" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_unique" ON "auth_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_expires_index" ON "auth_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_email_unique" ON "auth_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_username_unique" ON "auth_users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_index" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "embedded_clients_client_id_unique" ON "embedded_clients" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "embedded_clients_tenant_status_index" ON "embedded_clients" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "embedded_sessions_integration_expiry_index" ON "embedded_sessions" USING btree ("integration_id","expires_at");--> statement-breakpoint
CREATE INDEX "embedded_sessions_user_expiry_index" ON "embedded_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "embedded_tickets_digest_unique" ON "embedded_tickets" USING btree ("ticket_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "embedded_tickets_jti_unique" ON "embedded_tickets" USING btree ("jti");--> statement-breakpoint
CREATE INDEX "embedded_tickets_integration_expiry_index" ON "embedded_tickets" USING btree ("integration_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_user_unique" ON "external_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "login_identifier_failures_updated_index" ON "login_identifier_failures" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "login_source_limits_updated_index" ON "login_source_limits" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "user_profiles_tenant_source_index" ON "user_profiles" USING btree ("tenant_id","source");