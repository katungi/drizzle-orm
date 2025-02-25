import 'dotenv/config';

import anyTest, { TestFn } from 'ava';
import Docker from 'dockerode';
import { sql } from 'drizzle-orm';
import { asc, eq, gt, inArray } from 'drizzle-orm/expressions';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
	alias,
	AnyPgColumn,
	boolean,
	char,
	cidr,
	inet,
	InferModel,
	integer,
	jsonb,
	macaddr,
	macaddr8,
	pgTable,
	serial,
	text,
	timestamp,
} from 'drizzle-orm/pg-core';
import { name, placeholder, SQL, SQLWrapper } from 'drizzle-orm/sql';
import getPort from 'get-port';
import { Client } from 'pg';
import { v4 as uuid } from 'uuid';

const usersTable = pgTable('users', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	verified: boolean('verified').notNull().default(false),
	jsonb: jsonb<string[]>('jsonb'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

const citiesTable = pgTable('cities', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	state: char('state', { length: 2 }),
});

const users2Table = pgTable('users2', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	cityId: integer('city_id').references(() => citiesTable.id),
});

const coursesTable = pgTable('courses', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	categoryId: integer('category_id').references(() => courseCategoriesTable.id),
});

const courseCategoriesTable = pgTable('course_categories', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
});

const orders = pgTable('orders', {
	id: serial('id').primaryKey(),
	region: text('region').notNull(),
	product: text('product').notNull(),
	amount: integer('amount').notNull(),
	quantity: integer('quantity').notNull(),
});

const network = pgTable('network_table', {
	inet: inet('inet').notNull(),
	cidr: cidr('cidr').notNull(),
	macaddr: macaddr('macaddr').notNull(),
	macaddr8: macaddr8('macaddr8').notNull(),
});

const salEmp = pgTable('sal_emp', {
	name: text('name'),
	payByQuarter: integer('pay_by_quarter').array(),
	schedule: text('schedule').array().array(),
});

const tictactoe = pgTable('tictactoe', {
	squares: integer('squares').array(3).array(3),
});

const usersMigratorTable = pgTable('users12', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull(),
});

interface Context {
	docker: Docker;
	pgContainer: Docker.Container;
	db: NodePgDatabase;
	client: Client;
}

const test = anyTest as TestFn<Context>;

async function createDockerDB(ctx: Context): Promise<string> {
	const docker = (ctx.docker = new Docker());
	const port = await getPort({ port: 5432 });
	const image = 'postgres:14';

	const pullStream = await docker.pull(image);
	await new Promise((resolve, reject) =>
		docker.modem.followProgress(pullStream, (err) => (err ? reject(err) : resolve(err)))
	);

	ctx.pgContainer = await docker.createContainer({
		Image: image,
		Env: ['POSTGRES_PASSWORD=postgres', 'POSTGRES_USER=postgres', 'POSTGRES_DB=postgres'],
		name: `drizzle-integration-tests-${uuid()}`,
		HostConfig: {
			AutoRemove: true,
			PortBindings: {
				'5432/tcp': [{ HostPort: `${port}` }],
			},
		},
	});

	await ctx.pgContainer.start();

	return `postgres://postgres:postgres@localhost:${port}/postgres`;
}

test.before(async (t) => {
	const ctx = t.context;
	const connectionString = process.env['PG_CONNECTION_STRING'] ?? (await createDockerDB(ctx));

	let sleep = 250;
	let timeLeft = 5000;
	let connected = false;
	let lastError: unknown | undefined;
	do {
		try {
			ctx.client = new Client(connectionString);
			await ctx.client.connect();
			connected = true;
			break;
		} catch (e) {
			lastError = e;
			await new Promise((resolve) => setTimeout(resolve, sleep));
			timeLeft -= sleep;
		}
	} while (timeLeft > 0);
	if (!connected) {
		console.error('Cannot connect to Postgres');
		await ctx.client?.end().catch(console.error);
		await ctx.pgContainer?.stop().catch(console.error);
		throw lastError;
	}
	ctx.db = drizzle(ctx.client, { logger: false });
});

test.after.always(async (t) => {
	const ctx = t.context;
	await ctx.client?.end().catch(console.error);
	await ctx.pgContainer?.stop().catch(console.error);
});

test.beforeEach(async (t) => {
	const ctx = t.context;
	await ctx.db.execute(sql`drop schema public cascade`);
	await ctx.db.execute(sql`create schema public`);
	await ctx.db.execute(
		sql`create table users (
			id serial primary key,
			name text not null,
			verified boolean not null default false, 
			jsonb jsonb,
			created_at timestamptz not null default now()
		)`,
	);
	await ctx.db.execute(
		sql`create table cities (
			id serial primary key,
			name text not null,
			state char(2)
		)`,
	);
	await ctx.db.execute(
		sql`create table users2 (
			id serial primary key,
			name text not null,
			city_id integer references cities(id)
		)`,
	);
	await ctx.db.execute(
		sql`create table course_categories (
			id serial primary key,
			name text not null
		)`,
	);
	await ctx.db.execute(
		sql`create table courses (
			id serial primary key,
			name text not null,
			category_id integer references course_categories(id)
		)`,
	);
	await ctx.db.execute(
		sql`create table orders (
			id serial primary key,
			region text not null,
			product text not null,
			amount integer not null,
			quantity integer not null
		)`,
	);
	await ctx.db.execute(
		sql`create table network_table (
			inet inet not null,
			cidr cidr not null,
			macaddr macaddr not null,
			macaddr8 macaddr8 not null
		)`,
	);
	await ctx.db.execute(
		sql`create table sal_emp (
			name text not null,
			pay_by_quarter integer[] not null,
			schedule text[][] not null
		)`,
	);
	await ctx.db.execute(
		sql`create table tictactoe (
			squares integer[3][3] not null
		)`,
	);
});

test.serial('select all fields', async (t) => {
	const { db } = t.context;

	const now = Date.now();

	await db.insert(usersTable).values({ name: 'John' });
	const result = await db.select().from(usersTable);

	t.assert(result[0]!.createdAt instanceof Date);
	t.assert(Math.abs(result[0]!.createdAt.getTime() - now) < 100);
	t.deepEqual(result, [
		{ id: 1, name: 'John', verified: false, jsonb: null, createdAt: result[0]!.createdAt },
	]);
});

test.serial('select sql', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' });
	const users = await db
		.select({
			name: sql`upper(${usersTable.name})`,
		})
		.from(usersTable);

	t.deepEqual(users, [{ name: 'JOHN' }]);
});

test.serial('select typed sql', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' });

	const users = await db.select({
		name: sql<string>`upper(${usersTable.name})`,
	}).from(usersTable);

	t.deepEqual(users, [{ name: 'JOHN' }]);
});

test.serial('insert returning sql', async (t) => {
	const { db } = t.context;

	const users = await db
		.insert(usersTable)
		.values({ name: 'John' })
		.returning({
			name: sql`upper(${usersTable.name})`,
		});

	t.deepEqual(users, [{ name: 'JOHN' }]);
});

test.serial('delete returning sql', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' });
	const users = await db
		.delete(usersTable)
		.where(eq(usersTable.name, 'John'))
		.returning({
			name: sql`upper(${usersTable.name})`,
		});

	t.deepEqual(users, [{ name: 'JOHN' }]);
});

test.serial('update returning sql', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' });
	const users = await db
		.update(usersTable)
		.set({ name: 'Jane' })
		.where(eq(usersTable.name, 'John'))
		.returning({
			name: sql`upper(${usersTable.name})`,
		});

	t.deepEqual(users, [{ name: 'JANE' }]);
});

test.serial('update with returning all fields', async (t) => {
	const { db } = t.context;

	const now = Date.now();

	await db.insert(usersTable).values({ name: 'John' });
	const users = await db
		.update(usersTable)
		.set({ name: 'Jane' })
		.where(eq(usersTable.name, 'John'))
		.returning();

	t.assert(users[0]!.createdAt instanceof Date);
	t.assert(Math.abs(users[0]!.createdAt.getTime() - now) < 100);
	t.deepEqual(users, [
		{ id: 1, name: 'Jane', verified: false, jsonb: null, createdAt: users[0]!.createdAt },
	]);
});

test.serial('update with returning partial', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' });
	const users = await db
		.update(usersTable)
		.set({ name: 'Jane' })
		.where(eq(usersTable.name, 'John'))
		.returning({
			id: usersTable.id,
			name: usersTable.name,
		});

	t.deepEqual(users, [{ id: 1, name: 'Jane' }]);
});

test.serial('delete with returning all fields', async (t) => {
	const { db } = t.context;

	const now = Date.now();

	await db.insert(usersTable).values({ name: 'John' });
	const users = await db.delete(usersTable).where(eq(usersTable.name, 'John')).returning();

	t.assert(users[0]!.createdAt instanceof Date);
	t.assert(Math.abs(users[0]!.createdAt.getTime() - now) < 100);
	t.deepEqual(users, [
		{ id: 1, name: 'John', verified: false, jsonb: null, createdAt: users[0]!.createdAt },
	]);
});

test.serial('delete with returning partial', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' });
	const users = await db.delete(usersTable).where(eq(usersTable.name, 'John')).returning({
		id: usersTable.id,
		name: usersTable.name,
	});

	t.deepEqual(users, [{ id: 1, name: 'John' }]);
});

test.serial('insert + select', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' });
	const result = await db.select().from(usersTable);
	t.deepEqual(result, [
		{ id: 1, name: 'John', verified: false, jsonb: null, createdAt: result[0]!.createdAt },
	]);

	await db.insert(usersTable).values({ name: 'Jane' });
	const result2 = await db.select().from(usersTable);
	t.deepEqual(result2, [
		{ id: 1, name: 'John', verified: false, jsonb: null, createdAt: result2[0]!.createdAt },
		{ id: 2, name: 'Jane', verified: false, jsonb: null, createdAt: result2[1]!.createdAt },
	]);
});

test.serial('json insert', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John', jsonb: ['foo', 'bar'] });
	const result = await db
		.select({
			id: usersTable.id,
			name: usersTable.name,
			jsonb: usersTable.jsonb,
		})
		.from(usersTable);

	t.deepEqual(result, [{ id: 1, name: 'John', jsonb: ['foo', 'bar'] }]);
});

test.serial('char insert', async (t) => {
	const { db } = t.context;

	await db.insert(citiesTable).values({ name: 'Austin', state: 'TX' });
	const result = await db
		.select({ id: citiesTable.id, name: citiesTable.name, state: citiesTable.state })
		.from(citiesTable);

	t.deepEqual(result, [{ id: 1, name: 'Austin', state: 'TX' }]);
});

test.serial('char update', async (t) => {
	const { db } = t.context;

	await db.insert(citiesTable).values({ name: 'Austin', state: 'TX' });
	await db.update(citiesTable).set({ name: 'Atlanta', state: 'GA' }).where(eq(citiesTable.id, 1));
	const result = await db
		.select({ id: citiesTable.id, name: citiesTable.name, state: citiesTable.state })
		.from(citiesTable);

	t.deepEqual(result, [{ id: 1, name: 'Atlanta', state: 'GA' }]);
});

test.serial('char delete', async (t) => {
	const { db } = t.context;

	await db.insert(citiesTable).values({ name: 'Austin', state: 'TX' });
	await db.delete(citiesTable).where(eq(citiesTable.state, 'TX'));
	const result = await db
		.select({ id: citiesTable.id, name: citiesTable.name, state: citiesTable.state })
		.from(citiesTable);

	t.deepEqual(result, []);
});

test.serial('insert with overridden default values', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John', verified: true });
	const result = await db.select().from(usersTable);

	t.deepEqual(result, [
		{ id: 1, name: 'John', verified: true, jsonb: null, createdAt: result[0]!.createdAt },
	]);
});

test.serial('insert many', async (t) => {
	const { db } = t.context;

	await db
		.insert(usersTable)
		.values(
			{ name: 'John' },
			{ name: 'Bruce', jsonb: ['foo', 'bar'] },
			{ name: 'Jane' },
			{ name: 'Austin', verified: true },
		);
	const result = await db
		.select({
			id: usersTable.id,
			name: usersTable.name,
			jsonb: usersTable.jsonb,
			verified: usersTable.verified,
		})
		.from(usersTable);

	t.deepEqual(result, [
		{ id: 1, name: 'John', jsonb: null, verified: false },
		{ id: 2, name: 'Bruce', jsonb: ['foo', 'bar'], verified: false },
		{ id: 3, name: 'Jane', jsonb: null, verified: false },
		{ id: 4, name: 'Austin', jsonb: null, verified: true },
	]);
});

test.serial('insert many with returning', async (t) => {
	const { db } = t.context;

	const result = await db
		.insert(usersTable)
		.values(
			{ name: 'John' },
			{ name: 'Bruce', jsonb: ['foo', 'bar'] },
			{ name: 'Jane' },
			{ name: 'Austin', verified: true },
		)
		.returning({
			id: usersTable.id,
			name: usersTable.name,
			jsonb: usersTable.jsonb,
			verified: usersTable.verified,
		});

	t.deepEqual(result, [
		{ id: 1, name: 'John', jsonb: null, verified: false },
		{ id: 2, name: 'Bruce', jsonb: ['foo', 'bar'], verified: false },
		{ id: 3, name: 'Jane', jsonb: null, verified: false },
		{ id: 4, name: 'Austin', jsonb: null, verified: true },
	]);
});

test.serial('select with group by as field', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' }, { name: 'Jane' }, { name: 'Jane' });

	const result = await db
		.select({ name: usersTable.name })
		.from(usersTable)
		.groupBy(usersTable.name);

	t.deepEqual(result, [{ name: 'Jane' }, { name: 'John' }]);
});

test.serial('select with group by as sql', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' }, { name: 'Jane' }, { name: 'Jane' });

	const result = await db
		.select({ name: usersTable.name })
		.from(usersTable)
		.groupBy(sql`${usersTable.name}`);

	t.deepEqual(result, [{ name: 'Jane' }, { name: 'John' }]);
});

test.serial('select with group by as sql + column', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' }, { name: 'Jane' }, { name: 'Jane' });

	const result = await db
		.select({ name: usersTable.name })
		.from(usersTable)
		.groupBy(sql`${usersTable.name}`, usersTable.id);

	t.deepEqual(result, [{ name: 'Jane' }, { name: 'Jane' }, { name: 'John' }]);
});

test.serial('select with group by as column + sql', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' }, { name: 'Jane' }, { name: 'Jane' });

	const result = await db
		.select({ name: usersTable.name })
		.from(usersTable)
		.groupBy(usersTable.id, sql`${usersTable.name}`);

	t.deepEqual(result, [{ name: 'Jane' }, { name: 'Jane' }, { name: 'John' }]);
});

test.serial('select with group by complex query', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' }, { name: 'Jane' }, { name: 'Jane' });

	const result = await db
		.select({ name: usersTable.name })
		.from(usersTable)
		.groupBy(usersTable.id, sql`${usersTable.name}`)
		.orderBy(asc(usersTable.name))
		.limit(1);

	t.deepEqual(result, [{ name: 'Jane' }]);
});

test.serial('build query', async (t) => {
	const { db } = t.context;

	const query = db
		.select({ id: usersTable.id, name: usersTable.name })
		.from(usersTable)
		.groupBy(usersTable.id, usersTable.name)
		.toSQL();

	t.deepEqual(query, {
		sql: 'select "id", "name" from "users" group by "users"."id", "users"."name"',
		params: [],
	});
});

test.serial('insert sql', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: sql`${'John'}` });
	const result = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
	t.deepEqual(result, [{ id: 1, name: 'John' }]);
});

test.serial('partial join with alias', async (t) => {
	const { db } = t.context;
	const customerAlias = alias(usersTable, 'customer');

	await db.insert(usersTable).values({ id: 10, name: 'Ivan' }, { id: 11, name: 'Hans' });
	const result = await db
		.select({
			user: {
				id: usersTable.id,
				name: usersTable.name,
			},
			customer: {
				id: customerAlias.id,
				name: customerAlias.name,
			},
		})
		.from(usersTable)
		.leftJoin(customerAlias, eq(customerAlias.id, 11))
		.where(eq(usersTable.id, 10));

	t.deepEqual(result, [
		{
			user: { id: 10, name: 'Ivan' },
			customer: { id: 11, name: 'Hans' },
		},
	]);
});

test.serial('full join with alias', async (t) => {
	const { db } = t.context;
	const customerAlias = alias(usersTable, 'customer');

	await db.insert(usersTable).values({ id: 10, name: 'Ivan' }, { id: 11, name: 'Hans' });

	const result = await db
		.select()
		.from(usersTable)
		.leftJoin(customerAlias, eq(customerAlias.id, 11))
		.where(eq(usersTable.id, 10));

	t.deepEqual(result, [
		{
			users: {
				id: 10,
				name: 'Ivan',
				verified: false,
				jsonb: null,
				createdAt: result[0]!.users.createdAt,
			},
			customer: {
				id: 11,
				name: 'Hans',
				verified: false,
				jsonb: null,
				createdAt: result[0]!.customer!.createdAt,
			},
		},
	]);
});

test.serial('insert with spaces', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: sql`'Jo   h     n'` });
	const result = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);

	t.deepEqual(result, [{ id: 1, name: 'Jo   h     n' }]);
});

test.serial('prepared statement', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' });
	const statement = db
		.select({
			id: usersTable.id,
			name: usersTable.name,
		})
		.from(usersTable)
		.prepare('statement1');
	const result = await statement.execute();

	t.deepEqual(result, [{ id: 1, name: 'John' }]);
});

test.serial('prepared statement reuse', async (t) => {
	const { db } = t.context;

	const stmt = db
		.insert(usersTable)
		.values({
			verified: true,
			name: placeholder('name'),
		})
		.prepare('stmt2');

	for (let i = 0; i < 10; i++) {
		await stmt.execute({ name: `John ${i}` });
	}

	const result = await db
		.select({
			id: usersTable.id,
			name: usersTable.name,
			verified: usersTable.verified,
		})
		.from(usersTable);

	t.deepEqual(result, [
		{ id: 1, name: 'John 0', verified: true },
		{ id: 2, name: 'John 1', verified: true },
		{ id: 3, name: 'John 2', verified: true },
		{ id: 4, name: 'John 3', verified: true },
		{ id: 5, name: 'John 4', verified: true },
		{ id: 6, name: 'John 5', verified: true },
		{ id: 7, name: 'John 6', verified: true },
		{ id: 8, name: 'John 7', verified: true },
		{ id: 9, name: 'John 8', verified: true },
		{ id: 10, name: 'John 9', verified: true },
	]);
});

test.serial('prepared statement with placeholder in .where', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' });
	const stmt = db
		.select({
			id: usersTable.id,
			name: usersTable.name,
		})
		.from(usersTable)
		.where(eq(usersTable.id, placeholder('id')))
		.prepare('stmt3');
	const result = await stmt.execute({ id: 1 });

	t.deepEqual(result, [{ id: 1, name: 'John' }]);
});

// TODO change tests to new structure
// test.serial('migrator', async (t) => {
// 	const { db } = t.context;
// 	await migrate(db, { migrationsFolder: './drizzle/pg' });

// 	await db.insert(usersMigratorTable).values({ name: 'John', email: 'email' });

// 	const result = await db.select().from(usersMigratorTable);

// 	t.deepEqual(result, [{ id: 1, name: 'John', email: 'email' }]);
// });

test.serial('insert via db.execute + select via db.execute', async (t) => {
	const { db } = t.context;

	await db.execute(
		sql`insert into ${usersTable} (${name(usersTable.name.name)}) values (${'John'})`,
	);

	const result = await db.execute<{ id: number; name: string }>(
		sql`select id, name from "users"`,
	);
	t.deepEqual(result.rows, [{ id: 1, name: 'John' }]);
});

test.serial('insert via db.execute + returning', async (t) => {
	const { db } = t.context;

	const inserted = await db.execute<{ id: number; name: string }>(
		sql`insert into ${usersTable} (${
			name(
				usersTable.name.name,
			)
		}) values (${'John'}) returning ${usersTable.id}, ${usersTable.name}`,
	);
	t.deepEqual(inserted.rows, [{ id: 1, name: 'John' }]);
});

test.serial('insert via db.execute w/ query builder', async (t) => {
	const { db } = t.context;

	const inserted = await db.execute<Pick<InferModel<typeof usersTable>, 'id' | 'name'>>(
		db
			.insert(usersTable)
			.values({ name: 'John' })
			.returning({ id: usersTable.id, name: usersTable.name }),
	);
	t.deepEqual(inserted.rows, [{ id: 1, name: 'John' }]);
});

test.serial('build query insert with onConflict do update', async (t) => {
	const { db } = t.context;

	const query = db
		.insert(usersTable)
		.values({ name: 'John', jsonb: ['foo', 'bar'] })
		.onConflictDoUpdate({ target: usersTable.id, set: { name: 'John1' } })
		.toSQL();

	t.deepEqual(query, {
		sql: 'insert into "users" ("name", "jsonb") values ($1, $2) on conflict ("id") do update set "name" = $3',
		params: ['John', '["foo","bar"]', 'John1'],
	});
});

test.serial('build query insert with onConflict do update / multiple columns', async (t) => {
	const { db } = t.context;

	const query = db
		.insert(usersTable)
		.values({ name: 'John', jsonb: ['foo', 'bar'] })
		.onConflictDoUpdate({ target: [usersTable.id, usersTable.name], set: { name: 'John1' } })
		.toSQL();

	t.deepEqual(query, {
		sql: 'insert into "users" ("name", "jsonb") values ($1, $2) on conflict ("id","name") do update set "name" = $3',
		params: ['John', '["foo","bar"]', 'John1'],
	});
});

test.serial('build query insert with onConflict do nothing', async (t) => {
	const { db } = t.context;

	const query = db
		.insert(usersTable)
		.values({ name: 'John', jsonb: ['foo', 'bar'] })
		.onConflictDoNothing()
		.toSQL();

	t.deepEqual(query, {
		sql: 'insert into "users" ("name", "jsonb") values ($1, $2) on conflict do nothing',
		params: ['John', '["foo","bar"]'],
	});
});

test.serial('build query insert with onConflict do nothing + target', async (t) => {
	const { db } = t.context;

	const query = db
		.insert(usersTable)
		.values({ name: 'John', jsonb: ['foo', 'bar'] })
		.onConflictDoNothing({ target: usersTable.id })
		.toSQL();

	t.deepEqual(query, {
		sql: 'insert into "users" ("name", "jsonb") values ($1, $2) on conflict ("id") do nothing',
		params: ['John', '["foo","bar"]'],
	});
});

test.serial('insert with onConflict do update', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' });

	await db
		.insert(usersTable)
		.values({ id: 1, name: 'John' })
		.onConflictDoUpdate({ target: usersTable.id, set: { name: 'John1' } });

	const res = await db
		.select({ id: usersTable.id, name: usersTable.name })
		.from(usersTable)
		.where(eq(usersTable.id, 1));

	t.deepEqual(res, [{ id: 1, name: 'John1' }]);
});

test.serial('insert with onConflict do nothing', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' });

	await db.insert(usersTable).values({ id: 1, name: 'John' }).onConflictDoNothing();

	const res = await db
		.select({ id: usersTable.id, name: usersTable.name })
		.from(usersTable)
		.where(eq(usersTable.id, 1));

	t.deepEqual(res, [{ id: 1, name: 'John' }]);
});

test.serial('insert with onConflict do nothing + target', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' });

	await db
		.insert(usersTable)
		.values({ id: 1, name: 'John' })
		.onConflictDoNothing({ target: usersTable.id });

	const res = await db
		.select({ id: usersTable.id, name: usersTable.name })
		.from(usersTable)
		.where(eq(usersTable.id, 1));

	t.deepEqual(res, [{ id: 1, name: 'John' }]);
});

test.serial('left join (flat object fields)', async (t) => {
	const { db } = t.context;

	const { id: cityId } = await db
		.insert(citiesTable)
		.values({ name: 'Paris' }, { name: 'London' })
		.returning({ id: citiesTable.id })
		.then((rows) => rows[0]!);

	await db.insert(users2Table).values({ name: 'John', cityId }, { name: 'Jane' });

	const res = await db
		.select({
			userId: users2Table.id,
			userName: users2Table.name,
			cityId: citiesTable.id,
			cityName: citiesTable.name,
		})
		.from(users2Table)
		.leftJoin(citiesTable, eq(users2Table.cityId, citiesTable.id));

	t.deepEqual(res, [
		{ userId: 1, userName: 'John', cityId, cityName: 'Paris' },
		{ userId: 2, userName: 'Jane', cityId: null, cityName: null },
	]);
});

test.serial('left join (grouped fields)', async (t) => {
	const { db } = t.context;

	const { id: cityId } = await db
		.insert(citiesTable)
		.values({ name: 'Paris' }, { name: 'London' })
		.returning({ id: citiesTable.id })
		.then((rows) => rows[0]!);

	await db.insert(users2Table).values({ name: 'John', cityId }, { name: 'Jane' });

	const res = await db
		.select({
			id: users2Table.id,
			user: {
				name: users2Table.name,
				nameUpper: sql<string>`upper(${users2Table.name})`,
			},
			city: {
				id: citiesTable.id,
				name: citiesTable.name,
				nameUpper: sql<string>`upper(${citiesTable.name})`,
			},
		})
		.from(users2Table)
		.leftJoin(citiesTable, eq(users2Table.cityId, citiesTable.id));

	t.deepEqual(res, [
		{
			id: 1,
			user: { name: 'John', nameUpper: 'JOHN' },
			city: { id: cityId, name: 'Paris', nameUpper: 'PARIS' },
		},
		{
			id: 2,
			user: { name: 'Jane', nameUpper: 'JANE' },
			city: null,
		},
	]);
});

test.serial('left join (all fields)', async (t) => {
	const { db } = t.context;

	const { id: cityId } = await db
		.insert(citiesTable)
		.values({ name: 'Paris' }, { name: 'London' })
		.returning({ id: citiesTable.id })
		.then((rows) => rows[0]!);

	await db.insert(users2Table).values({ name: 'John', cityId }, { name: 'Jane' });

	const res = await db
		.select()
		.from(users2Table)
		.leftJoin(citiesTable, eq(users2Table.cityId, citiesTable.id));

	t.deepEqual(res, [
		{
			users2: {
				id: 1,
				name: 'John',
				cityId,
			},
			cities: {
				id: cityId,
				name: 'Paris',
				state: null,
			},
		},
		{
			users2: {
				id: 2,
				name: 'Jane',
				cityId: null,
			},
			cities: null,
		},
	]);
});

test.serial('join subquery', async (t) => {
	const { db } = t.context;

	await db
		.insert(courseCategoriesTable)
		.values(
			{ name: 'Category 1' },
			{ name: 'Category 2' },
			{ name: 'Category 3' },
			{ name: 'Category 4' },
		);

	await db
		.insert(coursesTable)
		.values(
			{ name: 'Development', categoryId: 2 },
			{ name: 'IT & Software', categoryId: 3 },
			{ name: 'Marketing', categoryId: 4 },
			{ name: 'Design', categoryId: 1 },
		);

	const sq2 = db
		.select({
			categoryId: courseCategoriesTable.id,
			category: courseCategoriesTable.name,
			total: sql<number>`count(${courseCategoriesTable.id})`,
		})
		.from(courseCategoriesTable)
		.groupBy(courseCategoriesTable.id, courseCategoriesTable.name)
		.as('sq2');

	const res = await db
		.select({
			courseName: coursesTable.name,
			categoryId: sq2.categoryId,
		})
		.from(coursesTable)
		.leftJoin(sq2, eq(coursesTable.categoryId, sq2.categoryId))
		.orderBy(coursesTable.name);

	t.deepEqual(res, [
		{ courseName: 'Design', categoryId: 1 },
		{ courseName: 'Development', categoryId: 2 },
		{ courseName: 'IT & Software', categoryId: 3 },
		{ courseName: 'Marketing', categoryId: 4 },
	]);
});

test.serial('with ... select', async (t) => {
	const { db } = t.context;

	await db.insert(orders).values(
		{ region: 'Europe', product: 'A', amount: 10, quantity: 1 },
		{ region: 'Europe', product: 'A', amount: 20, quantity: 2 },
		{ region: 'Europe', product: 'B', amount: 20, quantity: 2 },
		{ region: 'Europe', product: 'B', amount: 30, quantity: 3 },
		{ region: 'US', product: 'A', amount: 30, quantity: 3 },
		{ region: 'US', product: 'A', amount: 40, quantity: 4 },
		{ region: 'US', product: 'B', amount: 40, quantity: 4 },
		{ region: 'US', product: 'B', amount: 50, quantity: 5 },
	);

	const regionalSales = db
		.select({
			region: orders.region,
			totalSales: sql`sum(${orders.amount})`.as<number>('total_sales'),
		})
		.from(orders)
		.groupBy(orders.region)
		.prepareWithSubquery('regional_sales');

	const topRegions = db
		.select({
			region: regionalSales.region,
		})
		.from(regionalSales)
		.where(
			gt(regionalSales.totalSales, db.select({ sales: sql`sum(${regionalSales.totalSales})/10` }).from(regionalSales)),
		)
		.prepareWithSubquery('top_regions');

	const result = await db
		.with(regionalSales, topRegions)
		.select({
			region: orders.region,
			product: orders.product,
			productUnits: sql<number>`sum(${orders.quantity})::int`,
			productSales: sql<number>`sum(${orders.amount})::int`,
		})
		.from(orders)
		.where(inArray(orders.region, db.select({ region: topRegions.region }).from(topRegions)))
		.groupBy(orders.region, orders.product)
		.orderBy(orders.region, orders.product);

	t.deepEqual(result, [
		{
			region: 'Europe',
			product: 'A',
			productUnits: 3,
			productSales: 30,
		},
		{
			region: 'Europe',
			product: 'B',
			productUnits: 5,
			productSales: 50,
		},
		{
			region: 'US',
			product: 'A',
			productUnits: 7,
			productSales: 70,
		},
		{
			region: 'US',
			product: 'B',
			productUnits: 9,
			productSales: 90,
		},
	]);
});

test.serial('select from subquery sql', async (t) => {
	const { db } = t.context;

	await db.insert(users2Table).values({ name: 'John' }, { name: 'Jane' });

	const sq = db
		.select({ name: sql<string>`${users2Table.name} || ' modified'`.as('name') })
		.from(users2Table)
		.as('sq');

	const res = await db.select({ name: sq.name }).from(sq);

	t.deepEqual(res, [{ name: 'John modified' }, { name: 'Jane modified' }]);
});

test.serial('select a field without joining its table', (t) => {
	const { db } = t.context;

	t.throws(() => db.select({ name: users2Table.name }).from(usersTable).prepare('query'));
});

test.serial('select all fields from subquery without alias', (t) => {
	const { db } = t.context;

	const sq = db.select({ name: sql<string>`upper(${users2Table.name})` }).from(users2Table).prepareWithSubquery('sq');

	t.throws(() => db.select().from(sq).prepare('query'));
});

test.serial('select count()', async (t) => {
	const { db } = t.context;

	await db.insert(usersTable).values({ name: 'John' }, { name: 'Jane' });

	const res = await db.select({ count: sql`count(*)` }).from(usersTable);

	t.deepEqual(res, [{ count: '2' }]);
});

test.serial('select count w/ custom mapper', async (t) => {
	const { db } = t.context;

	function count(value: AnyPgColumn | SQLWrapper): SQL<number>;
	function count(value: AnyPgColumn | SQLWrapper, alias: string): SQL.Aliased<number>;
	function count(value: AnyPgColumn | SQLWrapper, alias?: string): SQL<number> | SQL.Aliased<number> {
		const result = sql`count(${value})`.mapWith((v) => parseInt(v, 10));
		if (!alias) {
			return result;
		}
		return result.as(alias);
	}

	await db.insert(usersTable).values({ name: 'John' }, { name: 'Jane' });

	const res = await db.select({ count: count(sql`*`) }).from(usersTable);

	t.deepEqual(res, [{ count: 2 }]);
});

test.serial('network types', async (t) => {
	const { db } = t.context;

	const value: InferModel<typeof network> = {
		inet: '127.0.0.1',
		cidr: '192.168.100.128/25',
		macaddr: '08:00:2b:01:02:03',
		macaddr8: '08:00:2b:01:02:03:04:05',
	};

	await db.insert(network).values(value);

	const res = await db.select().from(network);

	t.deepEqual(res, [value]);
});

test.serial('array types', async (t) => {
	const { db } = t.context;

	const values: InferModel<typeof salEmp>[] = [
		{
			name: 'John',
			payByQuarter: [10000, 10000, 10000, 10000],
			schedule: [['meeting', 'lunch'], ['training', 'presentation']],
		},
		{
			name: 'Carol',
			payByQuarter: [20000, 25000, 25000, 25000],
			schedule: [['breakfast', 'consulting'], ['meeting', 'lunch']],
		},
	];

	await db.insert(salEmp).values(...values);

	const res = await db.select().from(salEmp);

	t.deepEqual(res, values);
});

test.serial('select for ...', (t) => {
	const { db } = t.context;

	const query = db
		.select()
		.from(users2Table)
		.for('update')
		.for('no key update', { of: users2Table })
		.for('no key update', { of: users2Table, skipLocked: true })
		.for('share', { of: users2Table, noWait: true })
		.toSQL();

	t.regex(
		query.sql,
		/ for update for no key update of "users2" for no key update of "users2" skip locked for share of "users2" no wait$/,
	);
});

test.serial('having', async (t) => {
	const { db } = t.context;

	await db.insert(citiesTable).values({ name: 'London' }, { name: 'Paris' }, { name: 'New York' });

	await db.insert(users2Table).values({ name: 'John', cityId: 1 }, { name: 'Jane', cityId: 1 }, {
		name: 'Jack',
		cityId: 2,
	});

	const result = await db
		.select({
			id: citiesTable.id,
			name: sql<string>`upper(${citiesTable.name})`.as('upper_name'),
			usersCount: sql<number>`count(${users2Table.id})::int`.as('users_count'),
		})
		.from(citiesTable)
		.leftJoin(users2Table, eq(users2Table.cityId, citiesTable.id))
		.where(({ name }) => sql`length(${name}) >= 3`)
		.groupBy(citiesTable.id)
		.having(({ usersCount }) => sql`${usersCount} > 0`)
		.orderBy(({ name }) => name);

	t.deepEqual(result, [
		{
			id: 1,
			name: 'LONDON',
			usersCount: 2,
		},
		{
			id: 2,
			name: 'PARIS',
			usersCount: 1,
		},
	]);
});
