import { marked, Token } from "marked";

export function splitMarkdownByHeadings(markdown: string): { key: string; isOptional: boolean, tokens: Token[] }[] {
    const tokens = marked.lexer(markdown);

    // First, split by headings
    let splitTokens = [];
    let currentSection: { key: string; isOptional: boolean, tokens: Token[] } = {
        key: "description",
        isOptional: false,
        tokens: [],
    }

    for (const token of tokens) {
        if (token.type === "heading" && token.depth <= 2) {
            // If we have a current section, push it to the splitTokens
            if (currentSection.tokens.length > 0) {
                splitTokens.push(currentSection);
            }
            // Start a new section
            let key = token.text.toLowerCase().trim();
            let isOptional = false;
            if (key.includes("(optional)")) {
                isOptional = true;
                key = key.replace("(optional)", "").trim();
            }
            currentSection = {
                key: key,
                isOptional: isOptional,
                tokens: [],
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


export function markdownToSchema(markdown: string): any {
    const schema: any = {
        type: "submission",
        properties: {},
        required: [],
    };

    // Split the markdown by headings
    const splitTokens = splitMarkdownByHeadings(markdown);

    // Now process each section
    for (const section of splitTokens) {
        let key = section.key;

        // Process the tokens in the section
        const firstToken = section.tokens[0];
        if (firstToken.type === "paragraph") {
            // If the first token is a paragraph, treat it as a description
            schema.properties[key] = {
                type: "string",
                description: firstToken.text.trim(),
            };
        } else if (firstToken.type === "list") {
            // If the first token is a list, treat it as an array of strings
            const items = firstToken.items.map((item: any) => item.text.trim());
            schema.properties[key] = {
                type: "array",
                items: { type: "string" },
                description: items.join(", "),
            };
        }
        else {
            continue; // Skip unsupported token types
        }
        // Add to required if not optional
        if (!section.isOptional) {
            schema.required.push(key);
        }
    }
    return schema;
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


export function markdownMatchSchema(markdown: string, schema: any): SubmissionRecords {
    const requiredKeys = schema.required || [];
    const properties = schema.properties || {};
    const resultObject: Record<string, string | (string | NestedListItem)[]> = {};

    const splitTokens = splitMarkdownByHeadings(markdown);
    // Check if all required keys are present in the markdown
    for (const key of requiredKeys) {
        const section = splitTokens.find((s) => s.key === key);
        if (!section) {
            throw new Error(`Required section "${key}" not found in markdown.`);
        }
    }

    // Check if invalid keys are present in the markdown
    const markdownKeys = splitTokens.map((s) => s.key);
    for (const key of markdownKeys) {
        if (!Object.hasOwn(properties, key)) {
            throw new Error(`Invalid section "${key}" found in markdown.`);
        }
    }

    // Check if duplicate keys are present in the markdown
    const keyCounts: Record<string, number> = {};
    for (const key of markdownKeys) {
        keyCounts[key] = (keyCounts[key] || 0) + 1;
        if (keyCounts[key] > 1) {
            throw new Error(`Duplicate section "${key}" found in markdown.`);
        }
    }

    for (const propKey in properties) {
        const section = splitTokens.find((s) => s.key === propKey);
        if (!section) {
            continue; // Skip if section not found
        }

        const prop = properties[propKey];
        if (prop.type === "string") {
            // If the property is a string, check if the first token is a paragraph
            const raw = section.tokens.map((t) => t.raw).join("").trim();
            if (section.isOptional && prop.description === raw) {
                // If the section is optional and the description matches, skip it
                continue;
            }
            resultObject[propKey] = raw;
        } else if (prop.type === "array") {

            const listTokens = section.tokens.filter((t) => t.type === "list");
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

            if (section.isOptional && listToken.items.length === 1 && listToken.items[0].text.trim() === prop.description) {
                // If the section is optional and the list matches the description, skip it
                continue;
            }

            // Convert the list token to a nested list structure
            const nestedList = tokensToNestedListRecursive(listToken, propKey);
            resultObject[propKey] = nestedList.items;
        }
    }
    return resultObject;
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


export function submissionRecordToMarkdown(value: SubmissionRecord): string {
    let markdown = "";
    if (Array.isArray(value)) {
        if (value.length === 0) {
        } else {
            markdown += value.map(item => {
                if (typeof item === "string") {
                    return `- ${item}`;
                } else if (typeof item === "object") {
                    return `- ${item.title}\n${nestedListToMarkdown(item, 1)}`;
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

export function postToMarkdown(record: SubmissionRecords): string {
    let markdown = "";

    let isFirst = true;
    for (const key in record) {
        const recordValue = record[key];

        if (key !== "description" || !isFirst) {
            markdown += `\n\n## ${capitalizeFirstLetter(key)}\n`;
        }
        isFirst = false;
        markdown += submissionRecordToMarkdown(recordValue);
    }

    return markdown.trim();
}



export function schemaToMarkdownTemplate(schema: any, record?: SubmissionRecords): string {
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
        const recordValue = (record && Object.hasOwn(record, key)) ? record[key] : null;

        if (key !== "description" || !isFirst) {
            markdown += `\n## ${capitalizeFirstLetter(key)}${isRequired ? "" : " (Optional)"}\n`;
        }
        isFirst = false;

        if (recordValue) {
            markdown += submissionRecordToMarkdown(recordValue);
        } else {
            if (schemaProp.type === "string") {
                markdown += schemaProp.description;
            } else if (schemaProp.type === "array") {
                markdown += `- ${schemaProp.description}`;
            }
        }
    }

    return markdown.trim();
}

