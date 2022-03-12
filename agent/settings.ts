const fs = require('frida-fs');

export const GAME_DLL = "jampgamei386.so"; // Game library
export const qTrue: number = 1; // QTRUE 
export const MAX_INFO_STRING: number = 1023; // Size of MAX_INFO_STRING
export const SV_TICKRATE: number = 20; // Server tickrate.

// Auxiliary allocated strings.
export const ipKey: NativePointer = Memory.allocUtf8String("ip");
export const snapsKey: NativePointer = Memory.allocUtf8String("snaps");
export const rateKey: NativePointer = Memory.allocUtf8String("rate");

// Compensation for high pings
export const highPingCompensation: number = SV_TICKRATE;

// Load banned hosts.
const bannedIpsData = fs.readFileSync('/home/jedi/bans.dat');
export const bannedIPsArray = bannedIpsData.toString().split('\n');