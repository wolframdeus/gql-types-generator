import glob from 'glob';
import * as path from 'path';
import * as fs from 'fs';

const cwd = process.cwd();

/**
 * Adds current working directory to path
 * @param {string} path
 * @returns {string}
 */
export function withCwd(path: string): string {
  return path.startsWith('/')
    ? cwd + path
    : cwd + '/' + path;
}

/**
 * Returns paths to files which compares passed pattern
 * @param {string} pattern
 * @returns {Promise<string[]>}
 */
export async function withCwdAndGlob(pattern: string): Promise<string[]> {
  const patterns = pattern.split(',').map(withCwd);

  const matches = await Promise.all(
    patterns.map(p => new Promise((res, rej) => {
      glob(p, (err, matches) => {
        if (err) {
          return rej(err);
        }
        res(matches);
      });
    })),
  );

  // Flatten and keep unique paths
  return matches.flat().reduce<string[]>((acc, p) => {
    if (!acc.includes(p)) {
      acc.push(p);
    }
    return acc;
  }, []);
}

/**
 * Returns content of files found with passed glob or globs
 * @returns {Promise<string>}
 * @param path
 */
export async function getFileContent(path: string | string[]): Promise<string> {
  const paths = Array.isArray(path) ? path : [path];
  const contents = await Promise.all(
    paths.map(p => {
      return new Promise<string>((res, rej) => {
        fs.readFile(p, (err, data) => {
          if (err) {
            return rej(err);
          }
          res(data.toString());
        })
      })
    }),
  );

  return contents.reduce((acc, c) => acc + c);
}

/**
 * Writes file with passed content
 * @param directory
 * @param fileName
 * @param {string} content
 */
export function write(content: string, directory: string, fileName: string) {
  return fs.writeFileSync(path.resolve(directory, fileName), content);
}
