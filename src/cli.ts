#!/usr/bin/env node

import 'colors';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as ora from 'ora';
import * as argParser from 'yargs';

import { rebuild, ModuleType } from './rebuild';
import { locateElectronPrebuilt } from './electron-locater';

const yargs = argParser
  .usage('Usage: electron-rebuild --version [version] --module-dir [path]')
  .help('h')
  .alias('h', 'help')
  .version(false)
  .describe('v', 'The version of Electron to build against')
  .alias('v', 'version')
  .describe('f', 'Force rebuilding modules, even if we would skip it otherwise')
  .alias('f', 'force')
  .describe('a', "Override the target architecture to something other than your system's")
  .alias('a', 'arch')
  .describe('m', 'The path to the node_modules directory to rebuild')
  .alias('m', 'module-dir')
  .describe('w', 'A specific module to build, or comma separated list of modules')
  .alias('w', 'which-module')
  .describe('o', 'Only build specified module, or comma separated list of modules. All others are ignored.')
  .alias('o', 'only')
  .describe('e', 'The path to electron-prebuilt')
  .alias('e', 'electron-prebuilt-dir')
  .describe('d', 'Custom header tarball URL')
  .alias('d', 'dist-url')
  .describe('t', 'The types of dependencies to rebuild.  Comma seperated list of "prod", "dev" and "optional".  Default is "prod,optional"')
  .alias('t', 'types')
  .describe('p', 'Rebuild in parallel, this is enabled by default on macOS and Linux')
  .alias('p', 'parallel')
  .describe('s', 'Rebuild modules sequentially, this is enabled by default on Windows')
  .alias('s', 'sequential')
  .describe('b', 'Build debug version of modules')
  .alias('b','debug')
  .epilog('Copyright 2016');

const argv = yargs.argv;

if (argv.h) {
  yargs.showHelp();
  process.exit(0);
}

if (process.argv.length === 3 && process.argv[2] === '--version') {
  try {
    /* tslint:disable */ console.log('Electron Rebuild Version:', require(path.resolve(__dirname, '../../package.json')).version); /* tslint:enable */
  } catch (err) {
    /* tslint:disable */ console.log('Electron Rebuild Version:', require(path.resolve(__dirname, '../package.json')).version); /* tslint:enable */
  }
  process.exit(0);
}

const handler = (err: Error) => {
  console.error('\nAn unhandled error occurred inside electron-rebuild'.red);
  console.error(`${err.message}\n\n${err.stack}`.red);
  process.exit(-1);
};

process.on('uncaughtException', handler);
process.on('unhandledRejection', handler);


(async () => {
  const electronPrebuiltPath = argv.e ? path.resolve(process.cwd(), (argv.e as string)) : locateElectronPrebuilt();
  let electronPrebuiltVersion = argv.v as string;

  if (!electronPrebuiltVersion) {
    try {
      if (!electronPrebuiltPath) throw new Error('electron-prebuilt not found');
      const pkgJson = require(path.join(electronPrebuiltPath, 'package.json'));

      electronPrebuiltVersion = pkgJson.version;
    } catch (e) {
      throw new Error('Unable to find electron-prebuilt\'s version number, either install it or specify an explicit version');
    }
  }

  let rootDirectory = argv.m as string;

  if (!rootDirectory) {
    // NB: We assume here that we're going to rebuild the immediate parent's
    // node modules, which might not always be the case but it's at least a
    // good guess
    rootDirectory = path.resolve(__dirname, '../../..');
    if (!await fs.pathExists(rootDirectory) || !await fs.pathExists(path.resolve(rootDirectory, 'package.json'))) {
      // Then we try the CWD
      rootDirectory = process.cwd();
      if (!await fs.pathExists(rootDirectory) || !await fs.pathExists(path.resolve(rootDirectory, 'package.json'))) {
        throw new Error('Unable to find parent node_modules directory, specify it via --module-dir, E.g. "--module-dir ." for the current directory');
      }
    }
  } else {
    rootDirectory = path.resolve(process.cwd(), rootDirectory);
  }

  let modulesDone = 0;
  let moduleTotal = 0;
  const rebuildSpinner = ora('Searching dependency tree').start();
  let lastModuleName: string;

  const redraw = (moduleName?: string) => {
    if (moduleName) lastModuleName = moduleName;

    if (argv.p) {
      rebuildSpinner.text = `Building modules: ${modulesDone}/${moduleTotal}`;
    } else {
      rebuildSpinner.text = `Building module: ${lastModuleName}, Completed: ${modulesDone}`;
    }
  };

  const rebuilder = rebuild({
    buildPath: rootDirectory,
    electronVersion: electronPrebuiltVersion,
    arch: (argv.a as string) || process.arch,
    extraModules: argv.w ? (argv.w as string).split(',') : [],
    onlyModules: argv.o ? (argv.o as string).split(',') : null,
    force: argv.f as boolean,
    headerURL: argv.d as string,
    types: argv.t ? (argv.t as string).split(',') as ModuleType[] : ['prod', 'optional'],
    mode: argv.p ? 'parallel' : (argv.s ? 'sequential' : undefined),
    debug: argv.b as boolean
  });

  const lifecycle = rebuilder.lifecycle;

  lifecycle.on('module-found', (moduleName: string) => {
    moduleTotal += 1;
    redraw(moduleName);
  });

  lifecycle.on('module-done', () => {
    modulesDone += 1;
    redraw();
  });

  try {
    await rebuilder;
  } catch (err) {
    rebuildSpinner.text = 'Rebuild Failed';
    rebuildSpinner.fail();
    throw err;
  }

  rebuildSpinner.text = 'Rebuild Complete';
  rebuildSpinner.succeed();
})();
