import { afterAll } from "vitest"

import { closeTestDb } from "./index"

afterAll(closeTestDb)
