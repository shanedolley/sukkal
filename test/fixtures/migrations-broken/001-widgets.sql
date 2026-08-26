CREATE TABLE widgets (id serial PRIMARY KEY, name text NOT NULL);

-- @down
DROP TABLE widgets;
