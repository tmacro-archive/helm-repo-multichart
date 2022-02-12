const core = require('@actions/core');
const exec = require('@actions/exec');

const work_dir = process.env.GITHUB_WORKSPACE;

async function getRefs() {
    const options = {
        cwd: work_dir,
        listeners: {
            stdline: line => {
                const parts = line.split(' ');
                refs.push(parts[0]);
            },
            stderr: buf => core.debug(buf.toString()),
        },
    };
    const ret_code = await exec.exec('git', ['fetch', '--unshallow'], options);
    core.debug(`ret_code: ${ret_code}`);
    return refs;
}

async function hasTag(tag) {
    try {
        await exec.exec('git', ['rev-parse', tag, '--'], options);
    } catch (err) {
        return false;
    }
    return true;
}

async function fetchHistory() {
    const options = { cwd: work_dir };
    const ret_code = await exec.exec('git', ['fetch', '--unshallow'], options);
    if (ret_code !== 0) {
        throw Error('Failed to fetch git history');
    }
}

async function getChangesForCommit(ref) {
    const paths = [];
    const options = {
        cwd: work_dir,
        listeners: {
            stdline: path => {
                paths.push(path);
            },
            stderr: buf => {
                core.debug(buf.toString());
            },
        },
    };
    const ret_code = await exec.exec(
        'git',
        ['diff', '--name-only', ref],
        options,
    );
    core.debug(`ret_code: ${ret_code}`);
    return paths;
}

async function getLatestChanges() {
    let changes = await getChangesForCommit('HEAD~1');
    if (!changes) {
        // No changes normally means an empty merge commit.
        // So we'll fetch the history and walk backwards until we find a change.
        await fetch_history();
        const refs = await getRefs();
        for (let i = 1; i < refs.length; i++) {
            changes = await getChangesForCommit(`${refs}~1`);
            if (changes) {
                break;
            }
        }
    }
    return changes;
}

async function createTag(tag) {
    const options = {
        cwd: work_dir,
        listeners: {
            stdline: line => {
                core.debug(line);
            },
            stderr: buf => {
                core.debug(buf.toString());
            },
        },
    };
    await exec.exec(
        'git',
        ['tag', tag],
        options,
    );
}

module.exports = {
    getRefs,
    hasTag,
    fetchHistory,
    getChangesForCommit,
    getLatestChanges,
    createTag
}
