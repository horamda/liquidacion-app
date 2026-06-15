const fs = require('fs/promises');
const path = require('path');

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let index = 0;
  let state = 'normal';
  let dollarTag = null;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (state === 'lineComment') {
      current += char;
      if (char === '\n') state = 'normal';
      index += 1;
      continue;
    }

    if (state === 'blockComment') {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        index += 2;
        state = 'normal';
        continue;
      }
      index += 1;
      continue;
    }

    if (state === 'singleQuote') {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        index += 2;
        continue;
      }
      if (char === "'") state = 'normal';
      index += 1;
      continue;
    }

    if (state === 'doubleQuote') {
      current += char;
      if (char === '"') state = 'normal';
      index += 1;
      continue;
    }

    if (state === 'dollarQuote') {
      if (sql.slice(index, index + dollarTag.length) === dollarTag) {
        current += dollarTag;
        index += dollarTag.length;
        state = 'normal';
        dollarTag = null;
        continue;
      }

      current += char;
      index += 1;
      continue;
    }

    if (char === '-' && next === '-') {
      current += char + next;
      index += 2;
      state = 'lineComment';
      continue;
    }

    if (char === '/' && next === '*') {
      current += char + next;
      index += 2;
      state = 'blockComment';
      continue;
    }

    if (char === "'") {
      current += char;
      index += 1;
      state = 'singleQuote';
      continue;
    }

    if (char === '"') {
      current += char;
      index += 1;
      state = 'doubleQuote';
      continue;
    }

    if (char === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        index += dollarTag.length;
        state = 'dollarQuote';
        continue;
      }
    }

    if (char === ';') {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = '';
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

async function main() {
  const schemaPath = path.resolve(__dirname, '..', '..', 'schema.sql');
  const schemaSql = await fs.readFile(schemaPath, 'utf8');
  const statements = splitSqlStatements(schemaSql);
  const db = require('./index');
  let client;
  let transactionStarted = false;

  try {
    client = await db.getClient();
    console.log(`Applying schema from ${schemaPath}`);
    await client.query('BEGIN');
    transactionStarted = true;

    for (let i = 0; i < statements.length; i += 1) {
      const statement = statements[i];
      console.log(`Running statement ${i + 1}/${statements.length}`);
      await client.query(statement);
    }

    await client.query('COMMIT');
    transactionStarted = false;
    console.log('Database schema applied successfully.');
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError);
      }
    }

    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    if (client) {
      client.release();
    }
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Unexpected migration error:', error);
    process.exit(1);
  });
}

module.exports = {
  splitSqlStatements,
};
