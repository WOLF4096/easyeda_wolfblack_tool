export async function ClearEmptySupplierProperties(dataSource = 'PCB') {
    // 弹窗确认
    eda.sys_Dialog.showConfirmationMessage('即将清空供应商为空的多余属性值，是否继续', '清空多余属性', '是', '否', 
        async mainButtonClicked => {
            if (mainButtonClicked) {
                try {

                    let netdataa;
                    // 根据数据源选择相应的获取方式
                    if (dataSource === 'SCH') {
                        netdataa = await eda.sch_Netlist.getNetlist('JLCEDA');
                        console.log('从原理图获取网表成功');
                    } else {
                        netdataa = await eda.pcb_Net.getNetlist('JLCEDA');
                        console.log('从PCB获取网表成功');
                    }

                    const jsonData = JSON.parse(netdataa);
                    // console.log(jsonData);
                    
                    // 根据数据源定义不同的基础属性列表
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
                    
                    // 根据数据源选择对应的基础属性列表
                    const baseProperties = dataSource === 'SCH' ? schematicBaseProperties : pcbBaseProperties;
                    console.log(`使用${dataSource}基础属性列表，共${baseProperties.length}个属性`);
                    
                    // 处理数据
                    let processedCount = 0;
                    
                    for (const key in jsonData) {
                        if (jsonData.hasOwnProperty(key)) {
                            const component = jsonData[key];
                            
                            // 检查是否存在props且Supplier为空
                            if (component.props && (!component.props.Supplier || component.props.Supplier === "")) {
                                // console.log(`处理元件 ${component.props.Designator || key}: Supplier为空`);
                                
                                // 遍历所有属性，清空非基础属性的值
                                for (const prop in component.props) {
                                    if (component.props.hasOwnProperty(prop)) {
                                        // 如果不是基础属性，则清空其值
                                        if (!baseProperties.includes(prop)) {
                                            // console.log(`清空属性: ${prop}`);
                                            component.props[prop] = ""; // 清空值而不是删除属性
                                        }
                                    }
                                }
                                
                                processedCount++;
                            }
                        }
                    }
                    
                    console.log(`处理完成，共处理了 ${processedCount} 个元件`);
                    
                    // 写回数据
                    const updatedJsonString = JSON.stringify(jsonData, null, 2);
                    let writeSuccess = false;
                    
                    try {
                        // 根据数据源选择相应的写回方式
                        if (dataSource === 'SCH') {
                            await eda.sch_Netlist.setNetlist('JLCEDA', updatedJsonString);
                        } else {
                            await eda.pcb_Net.setNetlist('JLCEDA', updatedJsonString);
                        }
                        writeSuccess = true;
                        console.log(`写回${dataSource}成功`);
                    } catch (writeError) {
                        console.warn(`写回${dataSource}失败:`, writeError);
                    }
                    
                    if (writeSuccess) {
                        eda.sys_Message.showToastMessage(`成功清空 ${processedCount} 个元件的多余属性值`, 2);
                        eda.sys_Log.add(`成功清空 ${processedCount} 个元件的多余属性值 (数据源: ${dataSource})`, "info");
                        eda.sys_PanelControl.openBottomPanel("log");
                    }
                    
                } catch (error) {
                    console.error('处理过程中发生未知错误:', error);
                    eda.sys_Message.showToastMessage('处理过程中发生错误', 2);
                }
                
            } else {
                // 选择否执行
                eda.sys_Message.showToastMessage("已取消操作", 2);   
            }
        });
}