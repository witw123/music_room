module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  testRegex: ".*\\.spec\\.ts$",
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          target: "es2022",
          esModuleInterop: true
        }
      }
    ]
  },
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
  moduleNameMapper: {
    "^@music-room/shared$": "<rootDir>/../../packages/shared/src/index.ts",
    "^@/(.*)$": "<rootDir>/src/$1"
  }
};
