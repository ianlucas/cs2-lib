/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
export default {
    transform: {
        "\\.[jt]sx?$": ["ts-jest", { useESM: true }]
    },
    moduleNameMapper: {
        "(.+)\\.js": "$1"
    },
    extensionsToTreatAsEsm: [".ts"],
    testEnvironment: "node"
};
