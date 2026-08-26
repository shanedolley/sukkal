CREATE TABLE gadgets (id serial PRIMARY KEY, widget_id int REFERENCES widgets (id));

-- @down
DROP TABLE gadgets;
