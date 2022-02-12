const Path = require('path');
const fs = require('fs');

const core = require('@actions/core');
const github = require('@actions/github');

const tc = require('@actions/tool-cache');
const yaml = require('js-yaml');
const git = require('./git');

// Default values for inputs
const defaultChartReleaserVersion = '3.8.0';
const defaultChartDir = 'charts';
const defaultDryRun = false;

// Get the working directory
const work_dir = process.env.GITHUB_WORKSPACE;

const chart_dir = core.getInput('chart_dir') || defaultChartDir;
const dry_run = core.getBooleanInput('dry_run') || defaultDryRun;

if (!work_dir) {
    core.setFailed('Unable to locate workspace!');
}

async function skipIfDryRun(func) {
    if (!dry_run) {
        return await func();
    }
    core.info('Skipping due to dry_run');
    return null;
}

async function fetchTools() {
    const chartReleaserVersion = core.getInput('chart_releaser_version') || defaultChartReleaserVersion;
    const chartReleaserPath = await tc.downloadTool(
        `https://github.com/helm/chart-releaser/releases/download/v${chartReleaserVersion}/chart-releaser_${chartReleaserVersion}_linux_amd64.tar.gz`,
    );
    const chartReleaserExtractedFolder = await tc.extractTar(
        chartReleaserPath,
        'tools/chart-releaser',
    );
    const chartReleaserCachedPath = await tc.cacheFile(
        `${chartReleaserExtractedFolder}/cr`,
        'cr',
        'cr',
        chartReleaserVersion,
    );
    core.addPath(chartReleaserCachedPath);
}

function loadChart(path) {
    return yaml.load(fs.readFileSync(path));
}

async function getChangedCharts() {
    const changes = await git.getLatestChanges();
    return changes.reduce((changed, path) => {
        if (path.startsWith(chart_dir)) {
            const [_, chart, ...relPath] = path.split('/');
            if (relPath.join('') === 'Chart.yaml') {
                const { name, version } = loadChart(
                    Path.resolve(`${work_dir}/${path}`),
                );
                changed.push({ chart: name, version });
            }
        }
        return changed;
    }, []);
}

async function getNeededTags(changes) {
    const tags = [];
    for (const change of changes) {
        const tag = `${change.chart}-${change.version}`;
        if (await git.hasTag(tag)) {
            core.debug(`Skipping existing tag ${tag}`);
        } else {
            tags.push(change);
        }
    }
    return tags;
}

async function releaseExists(tag) {
    const resp = await octokit.request(
        'GET /repos/{owner}/{repo}/releases/tags/{tag}',
        {
            ...github.context.repo,
            tag,
        },
    );
    console.log(resp);
}

async function getNeededBuilds(changes) {
    const releases = [];
    for (const change of changes) {
        const tag = `${change.chart}-${change.version}`;
        if (await releaseExists(tag)) {
            core.debug(`Skipping existing release ${tag}`);
        } else {
            releases.push(change);
        }
    }
    return releases;
}

async function main() {
    await fetchTools();
    const changes = await getChangedCharts();
    const neededTags = await getNeededTags(changes);
    const neededBuilds = await getNeededBuilds(changes);

    if (neededTags.length) {
        core.info(
            `Creating tags: ${neededTags
                .map(nt => `${nt.chart}-${nt.version}`)
                .join(', ')}`,
        );
        await skipIfDryRun(() => createTags(neededTags));
    } else {
        core.info('No tags to create');
    }

    if (neededBuilds.length) {
        core.info(
            `Packaging charts: ${neededBuilds
                .map(nb => `${nb.chart}-${nb.version}`)
                .join(', ')}`,
        );
        await skipIfDryRun(() => packageCharts(neededBuilds));

        core.info(
            `Publishing charts: ${neededBuilds
                .map(nb => `${nb.chart}-${nb.version}`)
                .join(', ')}`,
        );
        await skipIfDryRun(() => publishCharts(neededBuilds));

        core.info('Generating chart repo index');
        await skipIfDryRun(() => updateIndex());
    } else {
        core.info('Nothing to build');
    }
}

main()
    .then(() => core.info('Action Completed Successfully'))
    .catch(err => {
        core.error(JSON.stringify(err.stack, null, 4));
        core.setFailed(`Error during action execution! ${err}`);
    });
