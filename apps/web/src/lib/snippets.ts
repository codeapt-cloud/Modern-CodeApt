/**
 * Language-appropriate starter snippets, seeded into the editor when the
 * playground language changes (and on first load).
 */
import { CodeLanguage } from "@codeapt/shared";

export const STARTER_SNIPPETS: Record<CodeLanguage, string> = {
  [CodeLanguage.PYTHON]: `# Read a name from stdin (optional) and greet.
import sys

name = sys.stdin.readline().strip() or "world"
print(f"Hello, {name}!")
`,
  [CodeLanguage.JAVASCRIPT]: `// Read a name from stdin (optional) and greet.
const data = require("fs").readFileSync(0, "utf8").trim();
const name = data || "world";
console.log(\`Hello, \${name}!\`);
`,
  [CodeLanguage.JAVA]: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String name = sc.hasNextLine() ? sc.nextLine().trim() : "";
        if (name.isEmpty()) name = "world";
        System.out.println("Hello, " + name + "!");
    }
}
`,
  [CodeLanguage.CPP]: `#include <iostream>
#include <string>

int main() {
    std::string name;
    std::getline(std::cin, name);
    if (name.empty()) name = "world";
    std::cout << "Hello, " << name << "!" << std::endl;
    return 0;
}
`,
  [CodeLanguage.C]: `#include <stdio.h>
#include <string.h>

int main(void) {
    char name[128];
    if (fgets(name, sizeof(name), stdin) == NULL || name[0] == '\\n') {
        printf("Hello, world!\\n");
    } else {
        name[strcspn(name, "\\n")] = '\\0';
        printf("Hello, %s!\\n", name);
    }
    return 0;
}
`,
};
