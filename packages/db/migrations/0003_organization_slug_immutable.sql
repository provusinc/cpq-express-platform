-- Organization slugs are immutable (ADR-0001): the subdomain is the
-- Organization's address, and links, sessions and bookmarks depend on it.
CREATE FUNCTION "organizations_slug_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."slug" IS DISTINCT FROM OLD."slug" THEN
    RAISE EXCEPTION 'Organization slug is immutable (% → %)', OLD."slug", NEW."slug"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "organizations_slug_immutable"
  BEFORE UPDATE OF "slug" ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION "organizations_slug_immutable"();
