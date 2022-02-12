/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 386:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__(653);
const exec = __nccwpck_require__(824);

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
    const options = { cwd: work_dir };
    const ret_code = await exec.exec('git', ['rev-parse', tag], options);
    return ret_code === 0;
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

module.exports = {
    getRefs,
    hasTag,
    fetchHistory,
    getChangesForCommit,
    getLatestChanges,
}


/***/ }),

/***/ 653:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 824:
/***/ ((module) => {

module.exports = eval("require")("@actions/exec");


/***/ }),

/***/ 322:
/***/ ((module) => {

module.exports = eval("require")("@actions/github");


/***/ }),

/***/ 275:
/***/ ((module) => {

module.exports = eval("require")("@actions/tool-cache");


/***/ }),

/***/ 921:
/***/ ((module) => {

module.exports = eval("require")("js-yaml");


/***/ }),

/***/ 147:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ 17:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
(() => {
const Path = __nccwpck_require__(17);
const fs = __nccwpck_require__(147);

const core = __nccwpck_require__(653);
const github = __nccwpck_require__(322);

const tc = __nccwpck_require__(275);
const yaml = __nccwpck_require__(921);
const git = __nccwpck_require__(386);

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
                    __nccwpck_require__.ab + "helm-repo-multichart/" + work_dir + '/' + path,
                );
                changed.push({ name, version });
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

})();

module.exports = __webpack_exports__;
/******/ })()
;