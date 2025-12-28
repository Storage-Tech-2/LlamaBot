import { JSONSchema7, JSONSchema7Definition } from "json-schema";
import { marked, Token } from "marked";

export type SchemaSection = {
    key: string;
    isOptional: boolean;
    tokens: Token[];
    depth: number;
    headerText: string;
}

export function splitMarkdownByHeadings(markdown: string): SchemaSection[] {
    const tokens = marked.lexer(markdown);

    // First, split by headings
    let splitTokens = [];
    let currentSection: SchemaSection = {
        key: "description",
        isOptional: false,
        tokens: [],
        depth: 0,
        headerText: "",
    }

    for (const token of tokens) {
        if (token.type === "heading") {
            // If we have a current section, push it to the splitTokens
            if (currentSection.tokens.length > 0) {
                splitTokens.push(currentSection);
            }
            // Start a new section
            let text = token.text.trim();
            let isOptional = false;
            if (text.toLowerCase().includes("(optional)")) {
                isOptional = true;
                text = text.replace(/\(optional\)/i, "").trim();
            }

            let key = text.toLowerCase().replaceAll(/\s+/g, "-");

            // try to find parent headings to prefix the key
            for (let i = splitTokens.length - 1; i > 0; i--) {
                const prevSection = splitTokens[i];
                if (prevSection.depth < token.depth) {
                    key = `${prevSection.key}:${key}`;
                    break;
                }
            }


            currentSection = {
                key,
                isOptional: isOptional,
                tokens: [],
                depth: token.depth,
                headerText: text,
            };
        } else {
            // Add the token to the current section
            currentSection.tokens.push(token);
        }
    }

    if (currentSection.tokens.length > 0) {
        splitTokens.push(currentSection);
    }

    // remove empty sections
    splitTokens = splitTokens.filter(section => {
        // Remove sections that have no non-whitespace tokens
        return section.tokens.some(token => {
            if (token.type === "paragraph") {
                return token.text.trim().length > 0; // Paragraphs with text
            } else if (token.type === "list") {
                return token.items.some((item: any) => item.text.trim().length > 0); // Lists with items that have text
            }
            return false; // For other token types, we can consider them empty
        });
    });

    return splitTokens;
}


export type StyleInfo = {
    depth?: number;
    headerText?: string;
    isOrdered?: boolean;
}

export type StrictStyleInfo = {
    depth: number;
    headerText: string;
    isOrdered: boolean;
}

export function markdownToSchema(markdown: string): {
    schema: JSONSchema7,
    style: Record<string, StyleInfo>,
} {
    const schema: JSONSchema7 = {
        title: "Submission",
        type: "object",
    };
    const style: Record<string, StyleInfo> = {};

    // Split the markdown by headings
    const splitTokens = splitMarkdownByHeadings(markdown);

    // Now process each section
    for (const section of splitTokens) {
        if (!schema.properties) {
            schema.properties = {};
        }

        let key = section.key;

        // Process the tokens in the section
        const firstToken = section.tokens[0];
        if (firstToken.type === "paragraph") {
            // If the first token is a paragraph, treat it as a description
            schema.properties[key] = {
                type: "string",
                description: firstToken.text.trim(),
            };

            style[key] = {
                depth: section.depth,
                headerText: section.headerText,
            };

        } else if (firstToken.type === "list") {
            // If the first token is a list, treat it as an array of strings
            const items = firstToken.items.map((item: any) => item.text.trim());
            schema.properties[key] = {
                type: "array",
                items: { type: "string" },
                description: items.join(", "),
            };

            style[key] = {
                depth: section.depth,
                headerText: section.headerText,
                isOrdered: firstToken.ordered,
            };

            if (!section.isOptional) {
                schema.properties[key].minItems = 1;
            }
        }
        else {
            continue; // Skip unsupported token types
        }

        // Add to required if not optional
        if (!section.isOptional) {
            if (!schema.required) {
                schema.required = [];
            }

            schema.required.push(key);
        }
    }
    return {
        schema,
        style,
    }
}


export type NestedListItem = { title: string; isOrdered: boolean, items: (string | NestedListItem)[] };


export function tokensToNestedListRecursive(listToken: Token, name: string): NestedListItem {
    if (listToken.type !== "list") {
        throw new Error(`Expected a list token, but got ${listToken.type}`);
    }

    const object = {
        title: name,
        isOrdered: listToken.ordered,
        items: [] as NestedListItem[],
    };

    for (const item of listToken.items) {
        if (item.type === "list_item") {
            // If the item has a nested list, process it recursively
            if (item.tokens && item.tokens.length > 0 && item.tokens[0].type === "list") {
                const nestedList = tokensToNestedListRecursive(item.tokens[0], item.text.trim());
                object.items.push(nestedList);
            } else {
                // Otherwise, just add the text as a string
                object.items.push(item.text.trim());
            }
        } else {
            throw new Error(`Unexpected token type ${item.type} in list item`);
        }
    }
    return object;
}

export type SubmissionRecord = string | (string | NestedListItem)[];
export type SubmissionRecords = Record<string, SubmissionRecord>;


export function countCharactersInNestedList(nestedList: NestedListItem): number {
    let count = nestedList.title.length; // Count the title length
    nestedList.items.forEach(item => {
        if (typeof item === "string") {
            count += item.length; // Count the string length
        } else if (typeof item === "object") {
            count += countCharactersInNestedList(item); // Recursively count in nested lists
        }
    });
    return count;
}

export function countCharactersInRecord(record: SubmissionRecord): number {
    if (typeof record === "string") {
        return record.length;
    } else if (Array.isArray(record)) {
        return record.reduce((count, item) => {
            if (typeof item === "string") {
                return count + item.length;
            } else if (typeof item === "object") {
                return count + countCharactersInNestedList(item);
            }
            return count;
        }, 0);
    }
    return 0; // If the record is neither a string nor an array, return
}


export function markdownMatchSchema(markdown: string, schema: JSONSchema7, schemaStyles: Record<string, StyleInfo>): { records: SubmissionRecords, styles: Record<string, StyleInfo> } {
    const requiredKeys = schema.required || [];
    const schemaProps = schema.properties || {};
    const resultObject: Record<string, string | (string | NestedListItem)[]> = {};
    const newStyles: Record<string, StyleInfo> = {};

    const splitTokens = splitMarkdownByHeadings(markdown);
    // Check if all required keys are present in the markdown
    for (const key of requiredKeys) {
        const section = splitTokens.find((s) => s.key === key);
        if (!section) {
            throw new Error(`Required section "${key}" not found in markdown.`);
        }
    }

    // // Check if invalid keys are present in the markdown
    const markdownKeys = splitTokens.map((s) => s.key);
    // for (const key of markdownKeys) {
    //     if (!Object.hasOwn(properties, key)) {
    //         throw new Error(`Invalid section "${key}" found in markdown.`);
    //     }
    // }

    // Check if duplicate keys are present in the markdown
    const keyCounts: Record<string, number> = {};
    for (const key of markdownKeys) {
        keyCounts[key] = (keyCounts[key] || 0) + 1;
        if (keyCounts[key] > 1) {
            throw new Error(`Duplicate section "${key}" found in markdown.`);
        }
    }


    for (const section of splitTokens) {
        const propKey = section.key;
        const prop: JSONSchema7Definition | null = Object.hasOwn(schemaProps, propKey) ? schemaProps[propKey] : null;
        if (typeof prop === "boolean") continue;

        const listTokens = section.tokens.filter((t) => t.type === "list");
        const shouldBeList = (prop && prop.type === "array");
        const newStyle: StyleInfo = {};
        if (section.depth !== (schemaStyles[propKey]?.depth ?? undefined)) {
            newStyle.depth = section.depth;
        }
        if (section.headerText !== (schemaStyles[propKey]?.headerText ?? undefined)) {
            newStyle.headerText = section.headerText;
        }

        if (!shouldBeList) {
            // If the property is a string, check if the first token is a paragraph
            const raw = section.tokens.map((t) => t.raw).join("").trim();
            if (prop?.description === raw) {
                // If the section is optional and the description matches, skip it
                continue;
            }
            resultObject[propKey] = raw;
        } else {
            if (listTokens.length === 0) {
                throw new Error(`Section "${propKey}" should contain a list, but found none.`);
            }
            if (listTokens.length > 1) {
                throw new Error(`Section "${propKey}" should contain only one list, but found multiple.`);
            }
            const listToken = listTokens[0];
            if (listToken.type !== "list") {
                throw new Error(`Section "${propKey}" should be a list, but found ${listToken.type}.`);
            }

            const filteredItems = listToken.items.filter((item: any) => {
                // Remove items that are just the description
                return item.text.trim() !== prop?.description;
            });

            if (prop && prop.minItems && filteredItems.length < prop.minItems) {
                throw new Error(`Section "${propKey}" should contain at least ${prop.minItems} items, but found ${filteredItems.length}.`);
            }

            if (filteredItems.length === 0) {
                // If the section is optional and the list matches the description, skip it
                continue;
            }

            // Convert the list token to a nested list structure
            const nestedList = tokensToNestedListRecursive(listToken, propKey);
            resultObject[propKey] = nestedList.items;
            if (listToken.ordered !== (schemaStyles[propKey]?.isOrdered ?? undefined)) {
                newStyle.isOrdered = listToken.ordered;
            }
        }

        if (Object.keys(newStyle).length > 0) {
            newStyles[propKey] = newStyle;
        }
    }
    return {
        records: resultObject,
        styles: newStyles,
    };
}

export function nestedListToMarkdown(nestedList: NestedListItem, indentLevel: number = 0): string {
    let markdown = "";
    const indent = "  ".repeat(indentLevel);
    if (nestedList.isOrdered) {
        nestedList.items.forEach((item, index) => {
            if (typeof item === "string") {
                markdown += `${indent}${index + 1}. ${item}\n`;
            } else if (typeof item === "object") {
                markdown += `${indent}${index + 1}. ${item.title}\n`;
                if (item.items.length > 0) {
                    markdown += nestedListToMarkdown(item, indentLevel + 1);
                }
            }
        })
    } else {
        nestedList.items.forEach((item) => {
            if (typeof item === "string") {
                markdown += `${indent}- ${item}\n`;
            } else if (typeof item === "object") {
                markdown += `${indent}- ${item.title}\n`;
                if (item.items.length > 0) {
                    markdown += nestedListToMarkdown(item, indentLevel + 1);
                }
            }
        });
    }
    return markdown.trim();
}


export function submissionRecordToMarkdown(value: SubmissionRecord, style?: StyleInfo): string {
    let markdown = "";
    if (Array.isArray(value)) {
        if (value.length !== 0) {
            markdown += value.map((item, i) => {
                if (typeof item === "string") {
                    return style?.isOrdered ? `${i + 1}. ${item}` : `- ${item}`;
                } else if (typeof item === "object") {
                    return style?.isOrdered ? `${i + 1}. ${item.title}\n${nestedListToMarkdown(item, 1)}` : `- ${item.title}\n${nestedListToMarkdown(item, 1)}`;
                }
                return "";
            }).join("\n");
        }
    } else {
        markdown += `${value}\n`;
    }

    return markdown.trim();
}

export function capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export function getEffectiveStyle(key: string, schemaStyles?: Record<string, StyleInfo>, recordStyles?: Record<string, StyleInfo>): StrictStyleInfo {
    const recordStyle = Object.hasOwn(recordStyles || {}, key) ? recordStyles![key] : null;
    const schemaStyle = Object.hasOwn(schemaStyles || {}, key) ? schemaStyles![key] : null;
    
    const style = {
        depth: 2,
        headerText: capitalizeFirstLetter(key),
        isOrdered: false,
    }
    if (schemaStyle) {
        if (schemaStyle.depth !== undefined) style.depth = schemaStyle.depth;
        if (schemaStyle.headerText !== undefined) style.headerText = schemaStyle.headerText;
        if (schemaStyle.isOrdered !== undefined) style.isOrdered = schemaStyle.isOrdered;
    }
    if (recordStyle) {
        if (recordStyle.depth !== undefined) style.depth = recordStyle.depth;
        if (recordStyle.headerText !== undefined) style.headerText = recordStyle.headerText;
        if (recordStyle.isOrdered !== undefined) style.isOrdered = recordStyle.isOrdered;
    }
    return style;
}

export function postToMarkdown(record: SubmissionRecords, recordStyles?: Record<string, StyleInfo>, schemaStyles?: Record<string, StyleInfo>): string {
    let markdown = "";

    let isFirst = true;
    for (const key in record) {
        const recordValue = record[key];
        const styles = getEffectiveStyle(key, schemaStyles, recordStyles);

        const text = submissionRecordToMarkdown(recordValue, styles);
        if (text.length > 0) {
            if (key !== "description" || !isFirst) {
                markdown += `\n${'#'.repeat(styles.depth)} ${styles.headerText}\n`;
            }
            isFirst = false;
        }
        markdown += text;
    }

    return markdown.trim();
}

export function recordsToRawTextNoHeaders(record: SubmissionRecords): string {
    let result = [];
    for (const key in record) {
        result.push(submissionRecordToMarkdown(record[key], {}));
    }
    return result.join("\n");
}

export function stripHyperlinkNames(markdownString: string): string {
    return markdownString.replace(/\[[^\[\]]*\]\((.*?)\)/g, "$1");
}

export function schemaToMarkdownTemplate(schema: JSONSchema7, schemaStyles: Record<string, StyleInfo>, record?: SubmissionRecords, recordStyles?: Record<string, StyleInfo>, addExtraNewline: boolean = false): string {
    let markdown = "";
    const properties = schema.properties || {};

    const schemaKeys = Object.keys(properties);
    const recordKeys = record ? Object.keys(record) : [];

    const mergedKeys: string[] = [];
    let i = 0;
    let j = 0;
    while (i < schemaKeys.length || j < recordKeys.length) {
        const schemaKey = schemaKeys[i];
        const recordKey = recordKeys[j];
        if (schemaKey && (!recordKey || schemaKey.localeCompare(recordKey) < 0)) {
            if (!mergedKeys.includes(schemaKey)) {
                mergedKeys.push(schemaKey);
            }
            i++;
        } else if (recordKey && (!schemaKey || recordKey.localeCompare(schemaKey) < 0)) {
            if (!mergedKeys.includes(recordKey)) {
                mergedKeys.push(recordKey);
            }
            j++;
        } else {
            if (!mergedKeys.includes(schemaKey)) {
                mergedKeys.push(schemaKey);
            }
            i++;
            j++;
        }
    }

    const requiredKeys = schema.required || [];

    let isFirst = true;
    for (const key of mergedKeys) {
        const isRequired = requiredKeys.includes(key);

        const schemaProp = Object.hasOwn(properties, key) ? properties[key] : null;
        if (typeof schemaProp === "boolean") {
            continue;
        }

        const recordValue = (record && Object.hasOwn(record, key)) ? record[key] : null;

        const style = getEffectiveStyle(key, schemaStyles, recordStyles);
        if (key !== "description" || !isFirst) {
            markdown += (addExtraNewline ? '\n' : '') + `\n## ${style.headerText}${isRequired ? "" : " (Optional)"}\n`;
        }
        isFirst = false;

        let text = recordValue ? submissionRecordToMarkdown(recordValue, style) : "";
        if (text.length === 0 && schemaProp) {
            if (schemaProp.type === "string") {
                markdown += schemaProp.description;
            } else if (schemaProp.type === "array") {
                markdown += style.isOrdered ? `1. ${schemaProp.description}` : `- ${schemaProp.description}`;
            }
        }

        markdown += text;

    }

    return markdown.trim();
}

