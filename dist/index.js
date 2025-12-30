"use strict";
var edaEsbuildExportName = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/js/NetlistToSchematic.js
  var NetlistToSchematic_exports = {};
  __export(NetlistToSchematic_exports, {
    placeComponentsEfficiently: () => placeComponentsEfficiently
  });
  async function placeComponentsEfficiently(viewType = "PCB") {
    let jsonObject;
    let netdataa;
    if (viewType === "NET") {
      const userConfirmed = confirm("\u6CE8\u610F\uFF1A\u6B64\u64CD\u4F5C\u5C06\u4ECE \u5609\u7ACB\u521BEDA\u683C\u5F0F \u7684 \u7F51\u8868\u6587\u4EF6 \u83B7\u53D6\u5668\u4EF6\u5E76\u653E\u7F6E\u5230\u539F\u7406\u56FE\u4E2D\n\n\u662F\u5426\u7EE7\u7EED\uFF1F");
      if (!userConfirmed) {
        eda.sys_Message.showToastMessage("\u5DF2\u53D6\u6D88 \u4ECE \u7F51\u8868\u6587\u4EF6 \u653E\u7F6E\u5668\u4EF6 \u7684\u64CD\u4F5C", 2);
        return;
      }
      const listtxt = await eda.sys_FileSystem.openReadFileDialog();
      let fileContent = await listtxt.text();
      let jsonString;
      if (Array.isArray(fileContent)) {
        jsonString = fileContent.join("");
      } else if (typeof fileContent === "string") {
        jsonString = fileContent;
      } else {
        eda.sys_Message.showToastMessage("\u4E0D\u652F\u6301\u7684\u6587\u4EF6\u683C\u5F0F", "error");
      }
      netdataa = jsonString.trim();
    } else if (viewType === "PCB") {
      const userConfirmed = confirm("\u6CE8\u610F\uFF1A\u6B64\u64CD\u4F5C\u5C06\u4ECEPCB\u83B7\u53D6\u5668\u4EF6\u5E76\u653E\u7F6E\u5230\u539F\u7406\u56FE\u4E2D\n\n\u662F\u5426\u7EE7\u7EED\uFF1F");
      if (!userConfirmed) {
        eda.sys_Message.showToastMessage("\u5DF2\u53D6\u6D88 \u4ECE PCB \u653E\u7F6E\u5668\u4EF6 \u7684\u64CD\u4F5C", 2);
        return;
      }
      await switchToPCB2();
      eda.sys_Message.showToastMessage("\u6B63\u5728\u83B7\u53D6\u6570\u636E", 2);
      netdataa = await eda.pcb_Net.getNetlist("JLCEDA");
      await switchToSchematic2();
      await delay2(1e3);
    } else {
      eda.sys_Log.add(`\u4E0D\u652F\u6301\u7684\u5BFC\u5165\u65B9\u5F0F: ${importMethod}`, "error");
      throw new Error(`\u4E0D\u652F\u6301\u7684\u5BFC\u5165\u65B9\u5F0F: ${importMethod}`);
    }
    jsonObject = JSON.parse(netdataa);
    let cacheHitCount = 0;
    let queryCount = 0;
    const cNumberCache = /* @__PURE__ */ new Map();
    const nameExactCache = /* @__PURE__ */ new Map();
    const nameFuzzyCache = /* @__PURE__ */ new Map();
    const cNumberExactMatch = [];
    const nameExactMatch = [];
    const nameFuzzyMatch = [];
    const failedComponents = [];
    function delay2(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async function switchToPCB2() {
      try {
        const splitData = await eda.dmt_EditorControl.getSplitScreenTree();
        const pcbTab = splitData.tabs.find((tab) => tab.data?.doctype === 3);
        if (!pcbTab) {
          eda.sys_Log.add("\u672A\u627E\u5230PCB\u754C\u9762", "error");
          throw new Error("\u672A\u627E\u5230PCB\u754C\u9762");
        }
        await eda.dmt_EditorControl.activateDocument(pcbTab.tabId);
      } catch (error) {
        eda.sys_Log.add("\u5207\u6362PCB\u754C\u9762\u5931\u8D25", "error");
        console.error("\u5207\u6362PCB\u754C\u9762\u5931\u8D25:", error);
        throw new Error("\u5207\u6362PCB\u754C\u9762\u5931\u8D25");
      }
    }
    async function switchToSchematic2() {
      try {
        const splitData = await eda.dmt_EditorControl.getSplitScreenTree();
        const schTab = splitData.tabs.find((tab) => tab.data?.sch === true);
        if (!schTab) {
          eda.sys_Log.add("\u672A\u627E\u5230\u539F\u7406\u56FE\u754C\u9762", "error");
          throw new Error("\u672A\u627E\u5230\u539F\u7406\u56FE\u754C\u9762");
        }
        await eda.dmt_EditorControl.activateDocument(schTab.tabId);
      } catch (error) {
        eda.sys_Log.add("\u5207\u6362\u539F\u7406\u56FE\u754C\u9762\u5931\u8D25", "error");
        console.error("\u5207\u6362\u539F\u7406\u56FE\u754C\u9762\u5931\u8D25:", error);
        throw new Error("\u5207\u6362\u539F\u7406\u56FE\u754C\u9762\u5931\u8D25");
      }
    }
    const libUuid = await eda.lib_LibrariesList.getSystemLibraryUuid();
    if (!libUuid) {
      eda.sys_Message.showToastMessage("\u65E0\u6CD5\u83B7\u53D6\u7CFB\u7EDF\u5E93UUID", "error");
      return;
    }
    await createInfoTexts();
    const startTime = Date.now();
    await findUUIDs(jsonObject);
    const uuidLookupTime = Date.now();
    sortArraysByDesignator();
    await placeComponents();
    const endTime = Date.now();
    await showStatistics(startTime, uuidLookupTime, endTime);
    async function createInfoTexts() {
      await eda.sch_PrimitiveText.create(10, 30, "C\u7F16\u53F7\u7CBE\u786E\u5339\u914D\u2197", 0, "#00ff00", "Arial", 20, false, false, false, 0);
      await eda.sch_PrimitiveText.create(-140, 30, "\u2196\u540D\u79F0\u7CBE\u786E\u5339\u914D", 0, "#00ff00", "Arial", 20, false, false, false, 0);
      await eda.sch_PrimitiveText.create(-140, -10, "\u2199\u540D\u79F0\u6A21\u7CCA\u5339\u914D\n    \u9700\u8981\u4ED4\u7EC6\u68C0\u67E5", 0, "#00ff00", "Arial", 20, false, false, false, 0);
      await eda.sch_PrimitiveText.create(10, -10, "\u7EDF\u8BA1\u4FE1\u606F\u2198", 0, "#00ff00", "Arial", 20, false, false, false, 0);
      await eda.sch_PrimitiveText.create(10, -50, "\u8FD0\u884C\u8FC7\u7A0B\u4E2D\u4E0D\u8981\u5207\u6362\u89C6\u56FE\uFF0C\u5426\u5219\u4F1A\u505C\u6B62\u653E\u7F6E", 0, "#00ff00", "Arial", 30, false, false, false, 0);
    }
    async function findUUIDs(jsonObject2) {
      const totalComponents = Object.keys(jsonObject2).length;
      let processedCount = 0;
      const uuidLookupStartTime = Date.now();
      const progressText = await eda.sch_PrimitiveText.create(10, -100, "\u901A\u8FC7API\u67E5\u627E\u5668\u4EF6\u8FDB\u5EA6\uFF1A0/" + totalComponents + "\uFF0C0%", 0, "#00ff00", "Arial", 20, false, false, false, 0);
      console.log(`\u5F00\u59CB\u5904\u7406 ${totalComponents} \u4E2A\u5668\u4EF6...`);
      for (const [uniqueId, netItem] of Object.entries(jsonObject2)) {
        const designator = netItem.props["Designator"] || "";
        const name = netItem.props["Name"] || "";
        const deviceName = netItem.props["DeviceName"] || "";
        let uuid = "";
        let foundInCache = false;
        const lcscId = netItem.props["Supplier Part"];
        if (lcscId && lcscId.trim() !== "" && lcscId.startsWith("C")) {
          if (cNumberCache.has(lcscId)) {
            cacheHitCount++;
            uuid = cNumberCache.get(lcscId);
            foundInCache = true;
            cNumberExactMatch.push([uniqueId, lcscId, uuid, designator, name]);
            console.log(`\u7F13\u5B58\u547D\u4E2D C\u7F16\u53F7: ${lcscId} -> ${uuid}`);
          } else {
            queryCount++;
            try {
              console.log(`\u67E5\u8BE2 C\u7F16\u53F7: ${lcscId}`);
              const deviceInfo = await eda.lib_Device.getByLcscIds(lcscId, "", false);
              if (deviceInfo && deviceInfo[0] && deviceInfo[0].uuid) {
                uuid = deviceInfo[0].uuid;
                cNumberCache.set(lcscId, uuid);
                cNumberExactMatch.push([uniqueId, lcscId, uuid, designator, name]);
                console.log(`\u67E5\u8BE2\u6210\u529F C\u7F16\u53F7: ${lcscId} -> ${uuid}`);
              } else {
                console.log(`\u67E5\u8BE2\u5931\u8D25 C\u7F16\u53F7: ${lcscId}`);
              }
            } catch (error) {
              console.warn(`C\u7F16\u53F7\u67E5\u8BE2\u5931\u8D25: ${lcscId}`, error);
            }
          }
        }
        if (uuid) {
          processedCount++;
          updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
          continue;
        }
        if (deviceName && deviceName.trim() !== "" && !uuid) {
          if (nameExactCache.has(deviceName)) {
            cacheHitCount++;
            uuid = nameExactCache.get(deviceName);
            foundInCache = true;
            nameExactMatch.push([uniqueId, deviceName, uuid, designator, name]);
            console.log(`\u7F13\u5B58\u547D\u4E2D DeviceName\u7CBE\u786E: ${deviceName} -> ${uuid}`);
          }
        }
        if (uuid) {
          processedCount++;
          updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
          continue;
        }
        if (name && name.trim() !== "" && !uuid) {
          if (nameExactCache.has(name)) {
            cacheHitCount++;
            uuid = nameExactCache.get(name);
            foundInCache = true;
            nameExactMatch.push([uniqueId, name, uuid, designator, name]);
            console.log(`\u7F13\u5B58\u547D\u4E2D Name\u7CBE\u786E: ${name} -> ${uuid}`);
          }
        }
        if (uuid) {
          processedCount++;
          updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
          continue;
        }
        if (deviceName && deviceName.trim() !== "" && !uuid) {
          if (nameFuzzyCache.has(deviceName)) {
            cacheHitCount++;
            uuid = nameFuzzyCache.get(deviceName);
            foundInCache = true;
            nameFuzzyMatch.push([uniqueId, deviceName, uuid, designator, name]);
            console.log(`\u7F13\u5B58\u547D\u4E2D DeviceName\u6A21\u7CCA: ${deviceName} -> ${uuid}`);
          }
        }
        if (uuid) {
          processedCount++;
          updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
          continue;
        }
        if (name && name.trim() !== "" && !uuid) {
          if (nameFuzzyCache.has(name)) {
            cacheHitCount++;
            uuid = nameFuzzyCache.get(name);
            foundInCache = true;
            nameFuzzyMatch.push([uniqueId, name, uuid, designator, name]);
            console.log(`\u7F13\u5B58\u547D\u4E2D Name\u6A21\u7CCA: ${name} -> ${uuid}`);
          }
        }
        if (uuid) {
          processedCount++;
          updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
          continue;
        }
        if (deviceName && deviceName.trim() !== "" && !uuid && !foundInCache) {
          queryCount++;
          try {
            console.log(`API\u67E5\u8BE2 DeviceName: ${deviceName}`);
            const devices = await eda.lib_Device.search(deviceName);
            if (devices && devices.length > 0) {
              uuid = devices[0].uuid;
              if (devices[0].name === deviceName) {
                nameExactCache.set(deviceName, uuid);
                nameExactMatch.push([uniqueId, deviceName, uuid, designator, name]);
                console.log(`API\u67E5\u8BE2\u6210\u529F DeviceName\u7CBE\u786E: ${deviceName} -> ${uuid}`);
              } else if (devices.length > 1) {
                nameFuzzyCache.set(deviceName, uuid);
                nameFuzzyMatch.push([uniqueId, deviceName, uuid, designator, name]);
                console.log(`API\u67E5\u8BE2\u6210\u529F DeviceName\u6A21\u7CCA: ${deviceName} -> ${uuid}`);
              }
            } else {
              console.log(`API\u67E5\u8BE2\u5931\u8D25 DeviceName: ${deviceName}`);
            }
          } catch (error) {
            console.warn(`DeviceName API\u67E5\u8BE2\u5931\u8D25: ${deviceName}`, error);
          }
        }
        if (uuid) {
          processedCount++;
          updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
          continue;
        }
        if (name && name.trim() !== "" && !uuid && !foundInCache) {
          queryCount++;
          try {
            console.log(`API\u67E5\u8BE2 Name: ${name}`);
            const devices = await eda.lib_Device.search(name);
            if (devices && devices.length > 0) {
              uuid = devices[0].uuid;
              if (devices[0].name === name) {
                nameExactCache.set(name, uuid);
                nameExactMatch.push([uniqueId, name, uuid, designator, name]);
                console.log(`API\u67E5\u8BE2\u6210\u529F Name\u7CBE\u786E: ${name} -> ${uuid}`);
              } else if (devices.length > 1) {
                nameFuzzyCache.set(name, uuid);
                nameFuzzyMatch.push([uniqueId, name, uuid, designator, name]);
                console.log(`API\u67E5\u8BE2\u6210\u529F Name\u6A21\u7CCA: ${name} -> ${uuid}`);
              }
            } else {
              console.log(`API\u67E5\u8BE2\u5931\u8D25 Name: ${name}`);
            }
          } catch (error) {
            console.warn(`Name API\u67E5\u8BE2\u5931\u8D25: ${name}`, error);
          }
        }
        if (!uuid) {
          failedComponents.push([uniqueId, designator, name, deviceName]);
          console.log(`\u672A\u627E\u5230UUID: ${designator} - ${name} - ${deviceName}`);
        }
        processedCount++;
        updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
      }
      console.log(`UUID\u67E5\u627E\u5B8C\u6210: \u7F13\u5B58\u547D\u4E2D ${cacheHitCount} \u6B21, API\u67E5\u8BE2 ${queryCount} \u6B21`);
    }
    function updateProgress(progressText, current, total, startTime2, apiCount) {
      const percentage = (current / total * 100).toFixed(1);
      const elapsedTime = Date.now() - startTime2;
      let averageTimePerComponent = 0;
      if (apiCount > 0) {
        averageTimePerComponent = (elapsedTime / apiCount).toFixed(1);
      }
      eda.sch_PrimitiveText.modify(progressText.primitiveId, {
        "content": `\u901A\u8FC7API\u67E5\u627E\u5668\u4EF6\u8FDB\u5EA6\uFF1A${current}/${total}\uFF0C${percentage}%\uFF0C\u5E73\u5747${averageTimePerComponent}ms/\u4E2A`
      });
    }
    function sortArraysByDesignator() {
      const sortByDesignator = (a, b) => {
        const designatorA = a[3] || "";
        const designatorB = b[3] || "";
        return designatorA.localeCompare(designatorB, void 0, { numeric: true });
      };
      cNumberExactMatch.sort(sortByDesignator);
      nameExactMatch.sort(sortByDesignator);
      nameFuzzyMatch.sort(sortByDesignator);
    }
    async function placeComponents() {
      const placementText = await eda.sch_PrimitiveText.create(10, -120, "\u653E\u7F6E\u5668\u4EF6\u8FDB\u5EA6\uFF1A\u51C6\u5907\u4E2D...", 0, "#00ff00", "Arial", 20, false, false, false, 0);
      const totalToPlace = cNumberExactMatch.length + nameExactMatch.length + nameFuzzyMatch.length;
      let placedCount = 0;
      const placementStartTime = Date.now();
      const placementPromises = [];
      placementPromises.push(placeComponentArray(cNumberExactMatch, 100, 100, 1, 1, () => {
        placedCount++;
        updatePlacementProgress(placementText, placedCount, totalToPlace, placementStartTime);
      }));
      placementPromises.push(placeComponentArray(nameExactMatch, -100, 100, -1, 1, () => {
        placedCount++;
        updatePlacementProgress(placementText, placedCount, totalToPlace, placementStartTime);
      }));
      placementPromises.push(placeComponentArray(nameFuzzyMatch, -100, -100, -1, -1, () => {
        placedCount++;
        updatePlacementProgress(placementText, placedCount, totalToPlace, placementStartTime);
      }));
      await Promise.all(placementPromises);
    }
    function updatePlacementProgress(placementText, current, total, startTime2) {
      const percentage = (current / total * 100).toFixed(1);
      const elapsedTime = Date.now() - startTime2;
      let averageTimePerComponent = 0;
      if (current > 0) {
        averageTimePerComponent = (elapsedTime / current).toFixed(1);
      }
      eda.sch_PrimitiveText.modify(placementText.primitiveId, {
        "content": `\u901A\u8FC7API\u653E\u7F6E\u5668\u4EF6\u8FDB\u5EA6\uFF1A${current}/${total}\uFF0C${percentage}%\uFF0C\u5E73\u5747${averageTimePerComponent}ms/\u4E2A`
      });
    }
    async function placeComponentArray(componentArray, startX, startY, xDirection, yDirection, onPlacement) {
      const placementPromises = [];
      let x = startX;
      let y = startY;
      const xStep = 200 * xDirection;
      const yStep = 200 * yDirection;
      let countInRow = 0;
      const maxInRow = 20;
      for (const [uniqueId, , uuid, designator, name] of componentArray) {
        if (uuid) {
          const placementPromise = eda.sch_PrimitiveComponent.create({ "libraryUuid": libUuid, "uuid": uuid }, x, y, "", 0, false, true, true).then((result) => {
            result.setState_UniqueId(uniqueId);
            result.setState_Designator(designator);
            result.setState_Name(name);
            result.done();
            onPlacement();
          }).catch((error) => {
            console.error(`\u653E\u7F6E\u5668\u4EF6\u5931\u8D25: ${designator}`, error);
            failedComponents.push([uniqueId, designator, name, "\u653E\u7F6E\u5931\u8D25"]);
            onPlacement();
          });
          placementPromises.push(placementPromise);
        }
        countInRow++;
        if (countInRow >= maxInRow) {
          countInRow = 0;
          x = startX;
          y += yStep;
        } else {
          x += xStep;
        }
      }
      await Promise.all(placementPromises);
    }
    async function showStatistics(startTime2, uuidLookupTime2, endTime2) {
      const totalComponents = Object.keys(jsonObject).length;
      const successCount = cNumberExactMatch.length + nameExactMatch.length + nameFuzzyMatch.length;
      const failureCount = failedComponents.length;
      const totalTime = (endTime2 - startTime2) / 1e3;
      const uuidLookupTimeSec = (uuidLookupTime2 - startTime2) / 1e3;
      const placementTimeSec = (endTime2 - uuidLookupTime2) / 1e3;
      const cacheHitRate = queryCount > 0 ? (cacheHitCount / (cacheHitCount + queryCount) * 100).toFixed(2) : "100.00";
      const statsText = `
==== \u7EDF\u8BA1\u4FE1\u606F ====

\u603B\u5668\u4EF6\u6570: ${totalComponents}
\u653E\u7F6E\u6210\u529F: ${successCount}
\u653E\u7F6E\u5931\u8D25: ${failureCount}

\u67E5\u8BE2\u6B21\u6570: ${queryCount}
\u7F13\u5B58\u547D\u4E2D: ${cacheHitCount}
\u7F13\u5B58\u547D\u4E2D\u7387: ${cacheHitRate}%

\u5668\u4EF6\u67E5\u627E\u8017\u65F6: ${uuidLookupTimeSec.toFixed(2)}\u79D2
\u5668\u4EF6\u653E\u7F6E\u8017\u65F6: ${placementTimeSec.toFixed(2)}\u79D2
\u603B\u8017\u65F6: ${totalTime.toFixed(2)}\u79D2
\u5E73\u5747\u6BCF\u4E2A\u5668\u4EF6: ${(totalTime / totalComponents).toFixed(3)}\u79D2

${nameFuzzyMatch.length > 0 ? "\u5982\u6709\u5C11\u91CF\u6A21\u7CCA\u5339\u914D\u53EF\u624B\u52A8\u4FEE\u6539\n\u5982\u679C\u6A21\u7CCA\u5339\u914D\u592A\u591A\uFF0C\u5EFA\u8BAE\u5148\u505A\u5668\u4EF6\u6807\u51C6\u5316" : "\u5168\u90E8\u5668\u4EF6\u7CBE\u786E\u5339\u914D"}

${failureCount > 0 ? "\u5982\u6709\u5C11\u91CF\u5931\u8D25\u53EF\u624B\u52A8\u653E\u7F6E\n\u5982\u679C\u5931\u8D25\u592A\u591A\uFF0C\u5EFA\u8BAE\u5148\u505A\u5668\u4EF6\u6807\u51C6\u5316" : "\u6240\u6709\u5668\u4EF6\u653E\u7F6E\u6210\u529F"}

\u5B8C\u6210\u540E\u53EF\u624B\u52A8\u5C06\u6B64\u4FE1\u606F\u5220\u9664
        `.trim();
      await eda.sch_PrimitiveText.create(10, -160, statsText, 0, failureCount > 0 ? "#ff9900" : "#00ff00", "Arial", 16, false, false, false, 0);
      if (failedComponents.length > 0) {
        let failX = 300;
        let failY = -200;
        for (const [uniqueId, designator, name] of failedComponents) {
          const failText = `\u653E\u7F6E\u5931\u8D25
\u4F4D\u53F7:${designator}
\u540D\u79F0:${name}`;
          await eda.sch_PrimitiveText.create(failX, failY, failText, 0, "#ff0000", "Arial", 20, false, false, false, 0);
          failY -= 60;
          if (failY < -800) {
            failY = -300;
            failX += 150;
          }
        }
      }
    }
  }
  var init_NetlistToSchematic = __esm({
    "src/js/NetlistToSchematic.js"() {
      "use strict";
    }
  });

  // src/js/AutoWirePlacer.js
  var AutoWirePlacer_exports = {};
  __export(AutoWirePlacer_exports, {
    placeWires: () => placeWires
  });
  async function placeWires(importMethod2) {
    perfMonitor.start();
    try {
      const selectedComponents = await getSelectedComponent();
      if (!selectedComponents) {
        await eda.sys_Message.showToastMessage("\u8BF7\u5148\u5728\u539F\u7406\u56FE\u4E2D\u9009\u62E9\u4E00\u4E2A\u5668\u4EF6", 2);
        throw new Error("\u672A\u9009\u4E2D\u4EFB\u4F55\u5668\u4EF6");
      }
      const schematicNetlist = await getSchematicNetlist();
      let pcbNetlist;
      if (importMethod2 === "PCB") {
        await switchToPCB();
        eda.sys_Message.showToastMessage("\u6B63\u5728\u83B7\u53D6\u6570\u636E", 2);
        const pcbData = await getPCBSelection();
        await switchToSchematic();
        pcbNetlist = formatPCBNetlist(pcbData);
        await delay(1e3);
      } else if (importMethod2 === "NET") {
        const fileData = await importNetlistFromFile();
        pcbNetlist = formatFileNetlist(fileData, selectedComponents);
      } else {
        eda.sys_Log.add(`\u4E0D\u652F\u6301\u7684\u5BFC\u5165\u65B9\u5F0F: ${importMethod2}`, "error");
        throw new Error(`\u4E0D\u652F\u6301\u7684\u5BFC\u5165\u65B9\u5F0F: ${importMethod2}`);
      }
      const formattedSchematicNetlist = formatSchematicNetlist(schematicNetlist, selectedComponents);
      const componentsArray = Array.isArray(selectedComponents) ? selectedComponents : [selectedComponents];
      const allResults = [];
      for (const selectedComponent of componentsArray) {
        const { componentIds, uniqueId, designator } = selectedComponent;
        const processedData = processNetlistData(
          componentIds,
          uniqueId,
          designator,
          formattedSchematicNetlist,
          pcbNetlist
        );
        if (processedData.length === 0) {
          continue;
        }
        const drawResults = await drawWiresForPins(processedData);
        const successCount = drawResults.filter((r) => r.success).length;
        drawResults.forEach((result) => {
          perfMonitor.addWire(result.success);
        });
        allResults.push({
          designator,
          uniqueId,
          componentIds,
          results: drawResults,
          successCount: drawResults.filter((r) => r.success).length,
          totalCount: drawResults.length
        });
      }
      const performanceStats = perfMonitor.end();
      const totalSuccess = allResults.reduce((sum, result) => sum + result.successCount, 0);
      if (allResults.length === 0) {
        await eda.sys_Message.showToastMessage("\u6CA1\u6709\u9700\u8981\u653E\u7F6E\u5BFC\u7EBF\u7684\u5F15\u811A", 2);
        return {
          success: true,
          data: [],
          message: "\u6CA1\u6709\u9700\u8981\u653E\u7F6E\u5BFC\u7EBF\u7684\u5F15\u811A"
        };
      }
      const message = componentsArray.length > 1 ? `\u6210\u529F\u4E3A ${componentsArray.length} \u4E2A\u5668\u4EF6\u7684 ${totalSuccess} \u4E2A\u5F15\u811A\u653E\u7F6E\u5BFC\u7EBF\uFF0C\u603B\u8017\u65F6: ${performanceStats.totalTime.toFixed(2)}s\uFF0C\u5E73\u5747\u4E00\u6761\u5BFC\u7EBF\u8017\u65F6: ${performanceStats.avgTimePerWire.toFixed(2)}ms` : `\u6210\u529F\u4E3A\u5668\u4EF6 ${componentsArray[0].designator} \u7684 ${totalSuccess} \u4E2A\u5F15\u811A\u653E\u7F6E\u5BFC\u7EBF\uFF0C\u603B\u8017\u65F6: ${performanceStats.totalTime.toFixed(2)}s\uFF0C\u5E73\u5747\u4E00\u6761\u5BFC\u7EBF\u8017\u65F6: ${performanceStats.avgTimePerWire.toFixed(2)}ms`;
      eda.sys_Message.showToastMessage("\u5B8C\u6210", 3);
      eda.sys_Log.add(message, "info");
      return {
        success: true,
        data: allResults,
        message,
        performance: performanceStats
        // 添加性能数据
      };
    } catch (error) {
      const performanceStats = perfMonitor.end();
      console.error("\u653E\u7F6E\u5BFC\u7EBF\u5931\u8D25:", error);
      return {
        success: false,
        message: error.message,
        performance: performanceStats
        // 添加性能数据
      };
    }
  }
  async function switchToPCB() {
    try {
      const splitData = await eda.dmt_EditorControl.getSplitScreenTree();
      const pcbTab = splitData.tabs.find((tab) => tab.data?.doctype === 3);
      if (!pcbTab) {
        eda.sys_Log.add("\u672A\u627E\u5230PCB\u754C\u9762", "error");
        throw new Error("\u672A\u627E\u5230PCB\u754C\u9762");
      }
      await eda.dmt_EditorControl.activateDocument(pcbTab.tabId);
    } catch (error) {
      eda.sys_Log.add("\u5207\u6362PCB\u754C\u9762\u5931\u8D25", "error");
      console.error("\u5207\u6362PCB\u754C\u9762\u5931\u8D25:", error);
      throw new Error("\u5207\u6362PCB\u754C\u9762\u5931\u8D25");
    }
  }
  async function switchToSchematic() {
    try {
      const splitData = await eda.dmt_EditorControl.getSplitScreenTree();
      const schTab = splitData.tabs.find((tab) => tab.data?.sch === true);
      if (!schTab) {
        eda.sys_Log.add("\u672A\u627E\u5230\u539F\u7406\u56FE\u754C\u9762", "error");
        throw new Error("\u672A\u627E\u5230\u539F\u7406\u56FE\u754C\u9762");
      }
      await eda.dmt_EditorControl.activateDocument(schTab.tabId);
    } catch (error) {
      eda.sys_Log.add("\u5207\u6362\u539F\u7406\u56FE\u754C\u9762\u5931\u8D25", "error");
      console.error("\u5207\u6362\u539F\u7406\u56FE\u754C\u9762\u5931\u8D25:", error);
      throw new Error("\u5207\u6362\u539F\u7406\u56FE\u754C\u9762\u5931\u8D25");
    }
  }
  async function getSchematicNetlist() {
    try {
      return await eda.sch_Netlist.getNetlist();
    } catch (error) {
      eda.sys_Log.add("\u83B7\u53D6\u539F\u7406\u56FE\u7F51\u8868\u5931\u8D25", "error");
      console.error("\u83B7\u53D6\u539F\u7406\u56FE\u7F51\u8868\u5931\u8D25:", error);
      throw new Error("\u83B7\u53D6\u539F\u7406\u56FE\u7F51\u8868\u5931\u8D25");
    }
  }
  async function getSelectedComponent() {
    try {
      const primitives = await eda.sch_SelectControl.getSelectedPrimitives();
      const components = primitives.filter((item) => item.primitiveType === "Component");
      if (components.length === 0) {
        return null;
      }
      const componentMap = /* @__PURE__ */ new Map();
      for (const component of components) {
        const uniqueId = component.param.uniqueId;
        const designator = component.param.designator;
        if (!componentMap.has(uniqueId)) {
          componentMap.set(uniqueId, {
            componentIds: [],
            uniqueId,
            designator
          });
        }
        componentMap.get(uniqueId).componentIds.push(component.id);
      }
      const uniqueComponents = Array.from(componentMap.values());
      if (uniqueComponents.length === 1) {
        const component = uniqueComponents[0];
        return {
          componentIds: component.componentIds,
          uniqueId: component.uniqueId,
          designator: component.designator
        };
      }
      return uniqueComponents.map((comp) => ({
        componentIds: comp.componentIds,
        uniqueId: comp.uniqueId,
        designator: comp.designator
      }));
    } catch (error) {
      eda.sys_Log.add("\u83B7\u53D6\u9009\u4E2D\u5668\u4EF6\u5931\u8D25", "error");
      console.error("\u83B7\u53D6\u9009\u4E2D\u5668\u4EF6\u5931\u8D25:", error);
      throw new Error("\u83B7\u53D6\u9009\u4E2D\u5668\u4EF6\u5931\u8D25");
    }
  }
  async function getPCBSelection() {
    try {
      const pcbData = await eda.pcb_SelectControl.getAllSelectedPrimitives();
      if (Array.isArray(pcbData)) {
        return pcbData.filter((item) => item.primitiveType === "Component");
      } else if (pcbData.primitiveType === "Component") {
        return [pcbData];
      } else {
        eda.sys_Log.add("PCB\u4E2D\u672A\u9009\u4E2D\u4EFB\u4F55\u5668\u4EF6", "error");
        throw new Error("PCB\u4E2D\u672A\u9009\u4E2D\u4EFB\u4F55\u5668\u4EF6");
      }
    } catch (error) {
      eda.sys_Log.add("\u83B7\u53D6PCB\u9009\u4E2D\u4FE1\u606F\u5931\u8D25", "error");
      console.error("\u83B7\u53D6PCB\u9009\u4E2D\u4FE1\u606F\u5931\u8D25:", error);
      throw new Error("\u83B7\u53D6PCB\u9009\u4E2D\u4FE1\u606F\u5931\u8D25");
    }
  }
  async function importNetlistFromFile() {
    try {
      const fileData = await eda.sys_FileSystem.openReadFileDialog([".enet"], false);
      if (!fileData) {
        throw new Error("\u672A\u9009\u62E9\u6587\u4EF6");
      }
      const fileContent = await readFileAsText(fileData);
      return fileContent;
    } catch (error) {
      console.error("\u5BFC\u5165\u7F51\u8868\u6587\u4EF6\u5931\u8D25:", error);
      throw new Error("\u5BFC\u5165\u7F51\u8868\u6587\u4EF6\u5931\u8D25");
    }
  }
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function(event) {
        resolve(event.target.result);
      };
      reader.onerror = function(error) {
        reject(error);
      };
      reader.readAsText(file);
    });
  }
  function formatSchematicNetlist(netlistData, selectedComponents) {
    const formatted = [];
    const parsedData = JSON.parse(netlistData);
    const componentsArray = Array.isArray(selectedComponents) ? selectedComponents : [selectedComponents];
    for (const component of componentsArray) {
      const uniqueId = component.uniqueId;
      const componentData = parsedData[uniqueId];
      if (!componentData) {
        console.warn(`\u26A0\uFE0F \u672A\u5728\u7F51\u8868\u4E2D\u627E\u5230\u5668\u4EF6 ${uniqueId}`);
        continue;
      }
      const { props, pins } = componentData;
      if (!props || !pins) {
        console.warn(`\u26A0\uFE0F \u5668\u4EF6 ${uniqueId} \u6570\u636E\u4E0D\u5B8C\u6574`);
        continue;
      }
      const pinEntries = Object.entries(pins);
      for (const [pinNumber, netName] of pinEntries) {
        formatted.push({
          uniqueId,
          designator: props.Designator,
          pin: pinNumber,
          netName: netName || ""
        });
      }
    }
    console.log(`\u5171 ${formatted.length} \u4E2A\u5F15\u811A`);
    return formatted;
  }
  function formatPCBNetlist(pcbData) {
    const formatted = [];
    const components = Array.isArray(pcbData) ? pcbData : [pcbData];
    for (const component of components) {
      if (component.primitiveType !== "Component") {
        continue;
      }
      const uniqueId = component.uniqueId;
      const designator = component.designator;
      if (component.pads && Array.isArray(component.pads)) {
        for (const pad of component.pads) {
          formatted.push({
            uniqueId,
            designator,
            pin: pad.num,
            netName: pad.net || ""
          });
        }
      }
    }
    return formatted;
  }
  function formatFileNetlist(fileData, selectedComponents) {
    return formatSchematicNetlist(fileData, selectedComponents);
  }
  function processNetlistData(componentIds, uniqueId, designator, schematicNetlist, pcbNetlist) {
    const result = [];
    const relevantPCBPins = pcbNetlist.filter((item) => item.uniqueId === uniqueId);
    const relevantSchematicPins = schematicNetlist.filter((item) => item.uniqueId === uniqueId);
    for (const pcbPin of relevantPCBPins) {
      const schematicPin = relevantSchematicPins.find((item) => item.pin === pcbPin.pin);
      const hasSchematicNet = schematicPin && schematicPin.netName && schematicPin.netName.trim() !== "";
      const hasPCBNet = pcbPin.netName && pcbPin.netName.trim() !== "";
      if (!hasSchematicNet && hasPCBNet) {
        for (const componentId of componentIds) {
          result.push({
            componentId,
            uniqueId,
            designator,
            pin: pcbPin.pin,
            netName: pcbPin.netName
          });
        }
      }
    }
    return result;
  }
  async function getMultiplePinPositions(pinsData) {
    const positions = {};
    const componentPinsMap = {};
    for (const pinData of pinsData) {
      const { componentId, pin } = pinData;
      if (!componentPinsMap[componentId]) {
        componentPinsMap[componentId] = [];
      }
      componentPinsMap[componentId].push(pin);
    }
    for (const [componentId, pins] of Object.entries(componentPinsMap)) {
      try {
        const pinsData2 = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(componentId);
        for (const pinNumber of pins) {
          const pinInfo = pinsData2.find((pin) => pin.pinNumber === pinNumber);
          if (pinInfo) {
            const angle = pinInfo.rotation;
            const positionKey = `${componentId}_${pinNumber}`;
            positions[positionKey] = {
              x: pinInfo.x,
              y: pinInfo.y,
              angle,
              rotation: pinInfo.rotation,
              pinName: pinInfo.pinName
            };
          } else {
            eda.sys_Log.add(`\u5728\u56FE\u5143 ${componentId} \u4E2D\u672A\u627E\u5230\u5F15\u811A ${pinNumber}`);
            console.warn(`\u5728\u56FE\u5143 ${componentId} \u4E2D\u672A\u627E\u5230\u5F15\u811A ${pinNumber}`);
          }
        }
      } catch (error) {
        eda.sys_Log.add(`\u83B7\u53D6\u56FE\u5143 ${componentId} \u5F15\u811A\u4FE1\u606F\u5931\u8D25:`, "error");
        console.error(`\u83B7\u53D6\u56FE\u5143 ${componentId} \u5F15\u811A\u4FE1\u606F\u5931\u8D25:`, error);
      }
    }
    return positions;
  }
  async function drawWiresForPins(pinsData) {
    const results = [];
    const pinPositions = await getMultiplePinPositions(pinsData);
    for (const pinData of pinsData) {
      try {
        const { componentId, pin, netName } = pinData;
        const pinInfo = pinPositions[`${componentId}_${pin}`];
        if (!pinInfo) {
          eda.sys_Log.add(`\u672A\u627E\u5230\u5F15\u811A ${pin} \u7684\u4F4D\u7F6E\u4FE1\u606F`, "warn");
          console.warn(`\u672A\u627E\u5230\u5F15\u811A ${pin} \u7684\u4F4D\u7F6E\u4FE1\u606F`);
          results.push({
            componentId,
            pin,
            netName,
            success: false,
            error: "\u672A\u627E\u5230\u5F15\u811A\u4F4D\u7F6E"
          });
          continue;
        }
        const drawResult = await drawSingleWire(pinInfo, netName);
        results.push({
          componentId,
          pin,
          netName,
          pinName: pinInfo.pinName,
          success: !!drawResult,
          wireId: drawResult?.primitiveId,
          coordinates: {
            start: { x: pinInfo.x, y: pinInfo.y },
            angle: pinInfo.angle
          }
        });
      } catch (error) {
        console.error(`\u4E3A\u5F15\u811A ${pinData.pin} \u7ED8\u5236\u5BFC\u7EBF\u5931\u8D25:`, error);
        results.push({
          componentId: pinData.componentId,
          pin: pinData.pin,
          netName: pinData.netName,
          success: false,
          error: error.message
        });
      }
    }
    return results;
  }
  async function drawSingleWire(pinInfo, netName) {
    const { x, y, angle } = pinInfo;
    let startX, startY, endX, endY;
    switch (angle) {
      case 0:
        startX = x;
        startY = y;
        endX = startX + WIRE_LENGTH;
        endY = startY;
        break;
      case 90:
        startX = x;
        startY = y;
        endX = startX;
        endY = startY - WIRE_LENGTH;
        break;
      case 180:
        startX = x;
        startY = y;
        endX = startX - WIRE_LENGTH;
        endY = startY;
        break;
      case 270:
        startX = x;
        startY = y;
        endX = startX;
        endY = startY + WIRE_LENGTH;
        break;
      default:
        startX = x;
        startY = y;
        endX = startX + WIRE_LENGTH;
        endY = startY;
        console.warn(`\u672A\u77E5\u7684\u89D2\u5EA6 ${angle}\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u65B9\u5411`);
    }
    try {
      const result = await eda.sch_PrimitiveWire.create([startX, startY, endX, endY], netName);
      return result;
    } catch (error) {
      eda.sys_Log.add("\u7ED8\u5236\u5BFC\u7EBF\u5931\u8D25", "error");
      console.log([startX, startY, endX, endY], netName);
      throw error;
    }
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  var WIRE_LENGTH, PerformanceMonitor, perfMonitor;
  var init_AutoWirePlacer = __esm({
    "src/js/AutoWirePlacer.js"() {
      "use strict";
      WIRE_LENGTH = 40;
      PerformanceMonitor = class {
        constructor() {
          this.startTime = 0;
          this.endTime = 0;
          this.totalWires = 0;
          this.successWires = 0;
        }
        start() {
          this.startTime = performance.now();
          this.totalWires = 0;
          this.successWires = 0;
          console.log(`\u6027\u80FD\u76D1\u63A7\u5F00\u59CB: ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`);
        }
        end() {
          this.endTime = performance.now();
          const totalTime = (this.endTime - this.startTime) / 1e3;
          const avgTimePerWire = totalTime > 0 && this.successWires > 0 ? totalTime * 1e3 / this.successWires : 0;
          console.log(`\u6027\u80FD\u7EDF\u8BA1:
\u6210\u529F\u653E\u7F6E\u5BFC\u7EBF\u6570\u91CF: ${this.successWires}
\u603B\u8017\u65F6: ${totalTime.toFixed(2)}s
\u5E73\u5747\u4E00\u6761\u5BFC\u7EBF\u8017\u65F6: ${avgTimePerWire.toFixed(2)}ms`);
          return {
            totalWires: this.totalWires,
            successWires: this.successWires,
            totalTime,
            avgTimePerWire
          };
        }
        addWire(success = true) {
          this.totalWires++;
          if (success) {
            this.successWires++;
          }
        }
      };
      perfMonitor = new PerformanceMonitor();
    }
  });

  // src/js/ClearEmptySupplierProperties.js
  var ClearEmptySupplierProperties_exports = {};
  __export(ClearEmptySupplierProperties_exports, {
    ClearEmptySupplierProperties: () => ClearEmptySupplierProperties
  });
  async function ClearEmptySupplierProperties(dataSource = "PCB") {
    eda.sys_Dialog.showConfirmationMessage(
      "\u5373\u5C06\u6E05\u7A7A\u4F9B\u5E94\u5546\u4E3A\u7A7A\u7684\u591A\u4F59\u5C5E\u6027\u503C\uFF0C\u662F\u5426\u7EE7\u7EED",
      "\u6E05\u7A7A\u591A\u4F59\u5C5E\u6027",
      "\u662F",
      "\u5426",
      async (mainButtonClicked) => {
        if (mainButtonClicked) {
          try {
            let netdataa;
            if (dataSource === "SCH") {
              netdataa = await eda.sch_Netlist.getNetlist("JLCEDA");
              console.log("\u4ECE\u539F\u7406\u56FE\u83B7\u53D6\u7F51\u8868\u6210\u529F");
            } else {
              netdataa = await eda.pcb_Net.getNetlist("JLCEDA");
              console.log("\u4ECEPCB\u83B7\u53D6\u7F51\u8868\u6210\u529F");
            }
            const jsonData = JSON.parse(netdataa);
            const schematicBaseProperties = [
              "Symbol",
              "Designator",
              "Supplier Part",
              "Manufacturer",
              "Manufacturer Part",
              "Supplier",
              "Add into BOM",
              "Convert to PCB",
              "Footprint",
              "Name",
              "Device",
              "Reuse Block",
              "Group ID",
              "Channel ID",
              "Unique ID",
              "FootprintName",
              "DeviceName",
              "SymbolName",
              "Footprint Name"
            ];
            const pcbBaseProperties = [
              "Footprint",
              "Designator",
              "Manufacturer",
              "Manufacturer Part",
              "Add into BOM",
              "3D Model",
              "3D Model Title",
              "3D Model Transform",
              "Name",
              "Device",
              "Unique ID",
              "Supplier Part",
              "FootprintName",
              "DeviceName",
              "Group ID",
              "Channel ID",
              "Reuse Block",
              "Convert to PCB"
            ];
            const baseProperties = dataSource === "SCH" ? schematicBaseProperties : pcbBaseProperties;
            console.log(`\u4F7F\u7528${dataSource}\u57FA\u7840\u5C5E\u6027\u5217\u8868\uFF0C\u5171${baseProperties.length}\u4E2A\u5C5E\u6027`);
            let processedCount = 0;
            for (const key in jsonData) {
              if (jsonData.hasOwnProperty(key)) {
                const component = jsonData[key];
                if (component.props && (!component.props.Supplier || component.props.Supplier === "")) {
                  for (const prop in component.props) {
                    if (component.props.hasOwnProperty(prop)) {
                      if (!baseProperties.includes(prop)) {
                        component.props[prop] = "";
                      }
                    }
                  }
                  processedCount++;
                }
              }
            }
            console.log(`\u5904\u7406\u5B8C\u6210\uFF0C\u5171\u5904\u7406\u4E86 ${processedCount} \u4E2A\u5143\u4EF6`);
            const updatedJsonString = JSON.stringify(jsonData, null, 2);
            let writeSuccess = false;
            try {
              if (dataSource === "SCH") {
                await eda.sch_Netlist.setNetlist("JLCEDA", updatedJsonString);
              } else {
                await eda.pcb_Net.setNetlist("JLCEDA", updatedJsonString);
              }
              writeSuccess = true;
              console.log(`\u5199\u56DE${dataSource}\u6210\u529F`);
            } catch (writeError) {
              console.warn(`\u5199\u56DE${dataSource}\u5931\u8D25:`, writeError);
            }
            if (writeSuccess) {
              eda.sys_Message.showToastMessage(`\u6210\u529F\u6E05\u7A7A ${processedCount} \u4E2A\u5143\u4EF6\u7684\u591A\u4F59\u5C5E\u6027\u503C`, 2);
              eda.sys_Log.add(`\u6210\u529F\u6E05\u7A7A ${processedCount} \u4E2A\u5143\u4EF6\u7684\u591A\u4F59\u5C5E\u6027\u503C (\u6570\u636E\u6E90: ${dataSource})`, "info");
              eda.sys_PanelControl.openBottomPanel("log");
            }
          } catch (error) {
            console.error("\u5904\u7406\u8FC7\u7A0B\u4E2D\u53D1\u751F\u672A\u77E5\u9519\u8BEF:", error);
            eda.sys_Message.showToastMessage("\u5904\u7406\u8FC7\u7A0B\u4E2D\u53D1\u751F\u9519\u8BEF", 2);
          }
        } else {
          eda.sys_Message.showToastMessage("\u5DF2\u53D6\u6D88\u64CD\u4F5C", 2);
        }
      }
    );
  }
  var init_ClearEmptySupplierProperties = __esm({
    "src/js/ClearEmptySupplierProperties.js"() {
      "use strict";
    }
  });

  // src/js/CheckDesignators.js
  var CheckDesignators_exports = {};
  __export(CheckDesignators_exports, {
    checkDuplicateDesignators: () => checkDuplicateDesignators
  });
  async function checkDuplicateDesignators() {
    try {
      let components = await eda.pcb_PrimitiveComponent.getAll();
      let pcbInfo = await eda.dmt_Pcb.getCurrentPcbInfo();
      const pcbid = pcbInfo.uuid + "@" + pcbInfo.parentProjectUuid;
      const designatorMap = {};
      for (let i = 0; i < components.length; i++) {
        const component = components[i];
        const designator = component.designator;
        const primitiveId = component.primitiveId;
        if (designator) {
          const upperDesignator = designator.toUpperCase();
          if (!designatorMap[upperDesignator]) {
            designatorMap[upperDesignator] = [];
          }
          designatorMap[upperDesignator].push({
            designator,
            primitiveId
          });
        }
      }
      let hasDuplicates = false;
      for (const [upperDesignator, items] of Object.entries(designatorMap)) {
        if (items.length > 1) {
          hasDuplicates = true;
          const duplicateList = items.map(
            (item) => `<span class="link" data-log-find-id="${item.primitiveId}" data-log-find-pcbid="${pcbid}" data-log-find-path="">${item.designator}(${item.primitiveId})</span>`
          ).join("\u3001");
          eda.sys_Log.add(`\u91CD\u590D\u4F4D\u53F7\uFF1A${duplicateList}`, "warn");
        }
      }
      if (!hasDuplicates) {
        eda.sys_Log.add("\u672A\u53D1\u73B0\u91CD\u590D\u4F4D\u53F7", "info");
      }
      eda.sys_PanelControl.openBottomPanel("log");
    } catch (error) {
      console.error("\u4F4D\u53F7\u67E5\u91CD\u5931\u8D25:", error);
      eda.sys_Log.add("\u4F4D\u53F7\u67E5\u91CD\u5931\u8D25\uFF1A" + error.message, "error");
      eda.sys_PanelControl.openBottomPanel("log");
    }
  }
  var init_CheckDesignators = __esm({
    "src/js/CheckDesignators.js"() {
      "use strict";
    }
  });

  // src/js/NetlistUpdate3DModels.js
  var NetlistUpdate3DModels_exports = {};
  __export(NetlistUpdate3DModels_exports, {
    update3DModelsFromNetlist: () => update3DModelsFromNetlist
  });
  async function update3DModelsFromNetlist() {
    try {
      console.log("\u6B65\u9AA41: \u5BFC\u5165\u7F51\u8868\u6587\u4EF6...");
      const netlistData = await importNetlistFile();
      if (!netlistData) return;
      console.log("\u6B65\u9AA42: \u89E3\u6790\u7F51\u8868\u6587\u4EF6...");
      const designator3DMap = parseNetlist3DInfo(netlistData);
      console.log(`\u627E\u5230 ${Object.keys(designator3DMap).length} \u4E2A\u5E263D\u6A21\u578B\u7684\u5668\u4EF6`);
      console.log("\u6B65\u9AA43: \u83B7\u53D6PCB\u5668\u4EF6\u4FE1\u606F...");
      const pcbComponents = await getAllPCBComponents();
      console.log(`PCB\u4E2D\u5171\u6709 ${pcbComponents.length} \u4E2A\u5668\u4EF6`);
      console.log("\u6B65\u9AA44: \u5339\u914D\u5E76\u66F4\u65B03D\u6A21\u578B...");
      const updateResults = await matchAndUpdateComponents(pcbComponents, designator3DMap);
      showUpdateResults(updateResults);
    } catch (error) {
      console.error("\u66F4\u65B0\u8FC7\u7A0B\u4E2D\u51FA\u73B0\u9519\u8BEF:", error);
      eda.sys_Message.showToastMessage("\u66F4\u65B0\u5931\u8D25: " + error.message, "error");
    }
    async function importNetlistFile() {
      try {
        const fileResult = await eda.sys_FileSystem.openReadFileDialog();
        if (!fileResult) {
          eda.sys_Message.showToastMessage("\u672A\u9009\u62E9\u6587\u4EF6", "warn");
          return null;
        }
        let fileContent;
        if (typeof fileResult === "object" && fileResult.text) {
          fileContent = await fileResult.text();
        } else {
          fileContent = fileResult;
        }
        let jsonString;
        if (Array.isArray(fileContent)) {
          jsonString = fileContent.join("");
        } else if (typeof fileContent === "string") {
          jsonString = fileContent;
        } else {
          throw new Error("\u4E0D\u652F\u6301\u7684\u6587\u4EF6\u683C\u5F0F");
        }
        jsonString = jsonString.trim();
        const jsonObject = JSON.parse(jsonString);
        eda.sys_Message.showToastMessage("\u7F51\u8868\u6587\u4EF6\u5BFC\u5165\u6210\u529F", "success");
        return jsonObject;
      } catch (error) {
        console.error("\u5BFC\u5165\u7F51\u8868\u6587\u4EF6\u5931\u8D25:", error);
        eda.sys_Message.showToastMessage("\u5BFC\u5165\u5931\u8D25: " + error.message, "error");
        return null;
      }
    }
    function parseNetlist3DInfo(netlistData) {
      const designator3DMap = {};
      let count = 0;
      for (const key in netlistData) {
        const component = netlistData[key];
        if (component && component.props) {
          const designator = component.props.Designator;
          const model3D = component.props["3D Model"];
          const modelTitle = component.props["3D Model Title"];
          const modelTransform = component.props["3D Model Transform"];
          if (designator && model3D && modelTitle && modelTransform) {
            designator3DMap[designator] = {
              "3D Model": model3D,
              "3D Model Title": modelTitle,
              "3D Model Transform": modelTransform
            };
            count++;
            if (count <= 5) {
              console.log(`\u627E\u5230\u5668\u4EF6: ${designator}, 3D\u6A21\u578B: ${modelTitle}`);
            }
          }
        }
      }
      return designator3DMap;
    }
    async function getAllPCBComponents() {
      try {
        const components = await eda.pcb_PrimitiveComponent.getAll();
        const validComponents = components.filter(
          (comp) => comp && comp.primitiveId && comp.designator
        );
        return validComponents;
      } catch (error) {
        console.error("\u83B7\u53D6PCB\u5668\u4EF6\u5931\u8D25:", error);
        throw error;
      }
    }
    async function matchAndUpdateComponents(pcbComponents, designator3DMap) {
      const results = {
        total: 0,
        matched: 0,
        updated: 0,
        failed: 0,
        details: []
      };
      for (const component of pcbComponents) {
        results.total++;
        const designator = component.designator;
        const primitiveId = component.primitiveId;
        if (!designator || !primitiveId) {
          console.warn(`\u5668\u4EF6\u7F3A\u5C11designator\u6216primitiveId:`, component);
          continue;
        }
        if (designator3DMap[designator]) {
          results.matched++;
          const modelInfo = designator3DMap[designator];
          try {
            console.log(`\u6B63\u5728\u66F4\u65B0\u5668\u4EF6 ${designator} (ID: ${primitiveId})`);
            await eda.pcb_PrimitiveComponent.modify(primitiveId, {
              otherProperty: {
                "3D Model": modelInfo["3D Model"],
                "3D Model Title": modelInfo["3D Model Title"],
                "3D Model Transform": modelInfo["3D Model Transform"]
              }
            });
            results.updated++;
            results.details.push({
              designator,
              primitiveId,
              success: true,
              modelTitle: modelInfo["3D Model Title"],
              message: "\u66F4\u65B0\u6210\u529F"
            });
            console.log(`\u2713 ${designator}: 3D\u6A21\u578B\u66F4\u65B0\u6210\u529F`);
          } catch (error) {
            results.failed++;
            results.details.push({
              designator,
              primitiveId,
              success: false,
              modelTitle: modelInfo["3D Model Title"],
              message: error.message || "\u66F4\u65B0\u5931\u8D25"
            });
            console.error(`\u2717 ${designator}: \u66F4\u65B0\u5931\u8D25`, error);
          }
        }
      }
      return results;
    }
    function showUpdateResults(results) {
      console.log("\n========== \u66F4\u65B0\u7ED3\u679C\u6C47\u603B ==========");
      console.log(`\u603B\u5171PCB\u5668\u4EF6: ${results.total}`);
      console.log(`\u5339\u914D\u5230\u7684\u5668\u4EF6: ${results.matched}`);
      console.log(`\u6210\u529F\u66F4\u65B0: ${results.updated}`);
      console.log(`\u66F4\u65B0\u5931\u8D25: ${results.failed}`);
      console.log("==============================\n");
      if (results.failed > 0) {
        console.log("\u5931\u8D25\u7684\u5668\u4EF6:");
        results.details.filter((item) => !item.success).forEach((item) => {
          console.log(`  ${item.designator}: ${item.message}`);
        });
      }
      if (results.updated > 0) {
        console.log("\u6210\u529F\u66F4\u65B0\u7684\u793A\u4F8B:");
        results.details.filter((item) => item.success).slice(0, 5).forEach((item) => {
          console.log(`  ${item.designator}: ${item.modelTitle}`);
        });
        if (results.updated > 5) {
          console.log(`  ...\u8FD8\u6709 ${results.updated - 5} \u4E2A\u5668\u4EF6`);
        }
      }
      const message = `\u66F4\u65B0\u5B8C\u6210: \u6210\u529F ${results.updated}/${results.matched} \u4E2A\u5668\u4EF6`;
      eda.sys_Message.showToastMessage(message, "success");
    }
  }
  var init_NetlistUpdate3DModels = __esm({
    "src/js/NetlistUpdate3DModels.js"() {
      "use strict";
    }
  });

  // src/index.ts
  var src_exports = {};
  __export(src_exports, {
    About: () => About,
    AutoWirePlacerNET: () => AutoWirePlacerNET,
    AutoWirePlacerPCB: () => AutoWirePlacerPCB,
    CheckDesignators: () => CheckDesignators,
    ClearEmptySupplierPropertiesPCB: () => ClearEmptySupplierPropertiesPCB,
    ClearEmptySupplierPropertiesSCH: () => ClearEmptySupplierPropertiesSCH,
    CodeConvert: () => CodeConvert,
    ImportBom: () => ImportBom,
    ImportImage: () => ImportImage,
    ImportQrcode: () => ImportQrcode,
    NetReplace: () => NetReplace,
    NetlistToSchematicNET: () => NetlistToSchematicNET,
    NetlistToSchematicPCB: () => NetlistToSchematicPCB,
    NetlistUpdate3DModels: () => NetlistUpdate3DModels,
    ReplaceComponent: () => ReplaceComponent,
    activate: () => activate
  });
  function activate(status, arg) {
  }
  async function NetlistToSchematicPCB() {
    const { placeComponentsEfficiently: placeComponentsEfficiently2 } = await Promise.resolve().then(() => (init_NetlistToSchematic(), NetlistToSchematic_exports));
    await placeComponentsEfficiently2("PCB");
  }
  async function NetlistToSchematicNET() {
    const { placeComponentsEfficiently: placeComponentsEfficiently2 } = await Promise.resolve().then(() => (init_NetlistToSchematic(), NetlistToSchematic_exports));
    await placeComponentsEfficiently2("NET");
  }
  async function AutoWirePlacerPCB() {
    const { placeWires: placeWires2 } = await Promise.resolve().then(() => (init_AutoWirePlacer(), AutoWirePlacer_exports));
    await placeWires2("PCB");
  }
  async function AutoWirePlacerNET() {
    const { placeWires: placeWires2 } = await Promise.resolve().then(() => (init_AutoWirePlacer(), AutoWirePlacer_exports));
    await placeWires2("NET");
  }
  async function ClearEmptySupplierPropertiesPCB() {
    const { ClearEmptySupplierProperties: ClearEmptySupplierProperties2 } = await Promise.resolve().then(() => (init_ClearEmptySupplierProperties(), ClearEmptySupplierProperties_exports));
    await ClearEmptySupplierProperties2("PCB");
  }
  async function ClearEmptySupplierPropertiesSCH() {
    const { ClearEmptySupplierProperties: ClearEmptySupplierProperties2 } = await Promise.resolve().then(() => (init_ClearEmptySupplierProperties(), ClearEmptySupplierProperties_exports));
    await ClearEmptySupplierProperties2("SCH");
  }
  async function CheckDesignators() {
    const { checkDuplicateDesignators: checkDuplicateDesignators2 } = await Promise.resolve().then(() => (init_CheckDesignators(), CheckDesignators_exports));
    await checkDuplicateDesignators2();
  }
  async function NetlistUpdate3DModels() {
    const { update3DModelsFromNetlist: update3DModelsFromNetlist2 } = await Promise.resolve().then(() => (init_NetlistUpdate3DModels(), NetlistUpdate3DModels_exports));
    await update3DModelsFromNetlist2();
  }
  async function NetReplace() {
    eda.sys_IFrame.openIFrame("/iframe/NetReplace.html", 470, 640, "NetReplace");
  }
  async function ReplaceComponent() {
    eda.sys_IFrame.openIFrame("/iframe/ReplaceComponent.html", 1280, 720, "ReplaceComponent");
  }
  async function ImportImage() {
    eda.sys_IFrame.openIFrame("/iframe/ImportImage.html", 960, 680, "ImportImage");
  }
  async function ImportBom() {
    eda.sys_IFrame.openIFrame("/iframe/ImportBom.html", 1280, 720, "ImportBom");
  }
  async function ImportQrcode() {
    eda.sys_IFrame.openIFrame("/iframe/ImportQrcode.html", 540, 640, "ImportQrcode");
  }
  function CodeConvert() {
    eda.sys_IFrame.openIFrame("/iframe/CodeConvert.html", 720, 640, "CodeConvert");
  }
  function About() {
    eda.sys_IFrame.openIFrame("/iframe/About.html", 540, 720, "About");
  }
  return __toCommonJS(src_exports);
})();
