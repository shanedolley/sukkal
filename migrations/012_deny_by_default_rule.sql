-- The rule that fires when no other rule can.
--
-- WHY THIS MIGRATION EXISTS. KPA-81 builds the engine that reads `policies`,
-- and ADR-0005 requires it to deny on failure. Two of those failures name no
-- rule among the four the brief seeded:
--
--   * an action no rule describes, such as `calendar.cancel`
--   * an action proposed while the table is empty, unreadable or malformed
--
-- Both must deny, and `audit_denial_names_a_rule` refuses a denial that names
-- no rule. So the engine has three choices: name a rule that did not fire,
-- return a denial the audit log cannot record, or name a rule that says what
-- actually happened. Only the third is honest, and this row is it.
--
-- It is absolute for the same reason the first two are. A default that Shane
-- can switch off is a policy layer that fails open, which ADR-0005 says is not
-- a policy layer.
--
-- THE BRIEF STILL NAMES FOUR RULES. This is a fifth row and not a fifth rule.
-- The four describe what KPA may do. This one describes what happens when the
-- four cannot be read, which is the engine's own behaviour written down where
-- the audit screen can render it beside every other refusal.

INSERT INTO policies (key, governs, effect, absolute) VALUES
  ('deny-by-default',
   'An action no rule describes, and any action proposed while the policy table cannot be read',
   'Deny. An unreadable rule and an unwritten rule say the same thing: nobody has judged this action.',
   true);

-- @down

-- `audit.rule` is a foreign key into this table and the log is append only, so
-- once an entry cites this rule the row cannot leave while `audit` stands.
-- Reversing 005 drops both tables together, which is the one path that removes
-- it, and 005 runs after this one because a reversal runs backwards.
--
-- So this deletes the row while nothing cites it and leaves it for 005
-- otherwise. It deliberately does not raise. A guard here would fail on every
-- database that ever recorded a default denial, and it would fail first, which
-- would stop `migrate down` before it reached the migration that can succeed.

DELETE FROM policies
 WHERE key = 'deny-by-default'
   AND NOT EXISTS (SELECT 1 FROM audit WHERE rule = 'deny-by-default');
