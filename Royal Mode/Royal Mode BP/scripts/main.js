import { world, system, ItemStack } from "@minecraft/server";

const CFG = {
  MIN: 1,
  MAX: 40,
  BASE: 10,
  HEART_ITEM_ID: "vig:heart",
  DROP_ONLY_ON_PLAYER_KILL: false,
  ANTI_LETHAL_HEAL_HP: 8,
  ROYAL_MODE: true,
  SAVE_EVERY_TICKS: 1
};

const TAG = "vhearts:";
const clamp = (n, a, b) => Math.max(a, Math.min(b, n | 0));
const getKey = (p) => ((p)).id ?? p.nameTag;
const dimId = (d) => d?.id?.includes("nether")
  ? "nether"
  : d?.id?.includes("the_end")
  ? "the_end"
  : "overworld";

class DB {
  constructor(prefix = "royalpos") {
    this.prefix = prefix;
  }

  key(id, i) {
    return `${this.prefix}:${id}_${i}`;
  }

  save(id, obj) {
    try {
      const str = JSON.stringify(obj);
      const parts = [];
      for (let i = 0; i < str.length; i += 32767) {
        parts.push(str.substring(i, i + 32767));
      }

      let idx = 0;
      while (world.getDynamicProperty(this.key(id, idx)) !== undefined) {
        world.setDynamicProperty(this.key(id, idx), undefined);
        idx++;
      }

      parts.forEach(
        (p, i) => {
          world.setDynamicProperty(this.key(id, i), p);
        }
      );
    } catch {}
  }

  load(id) {
    try {
      let idx = 0;
      let data = "";

      while (true) {
        const part = world.getDynamicProperty(this.key(id, idx));
        if (part === undefined) {
          break;
        }
        data += part;
        idx++;
      }

      if (!data) {
        return null;
      }

      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  delete(id) {
    try {
      let idx = 0;
      while (true) {
        const k = this.key(id, idx);
        if (world.getDynamicProperty(k) === undefined) {
          break;
        }
        world.setDynamicProperty(k, undefined);
        idx++;
      }
    } catch {}
  }
}

const POSDB = new DB("royalpos");
const lastDeath = new Map();

function dirToYawPitch(dir) {
  const yaw = (Math.atan2(-dir.x, dir.z) * 180) / Math.PI;
  const pitch = (-Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180) / Math.PI;
  return { yaw, pitch };
}

function savePos(p) {
  try {
    const k = getKey(p);
    const l = p.location;
    const d = p.dimension;
    const v = p.getViewDirection?.() ?? { x: 0, y: 0, z: 1 };
    const { yaw, pitch } = dirToYawPitch(v);

    POSDB.save(
      k,
      { dim: dimId(d), x: l.x, y: l.y, z: l.z, yaw, pitch }
    );
  } catch {}
}

function getSavedPosByKey(k) {
  return POSDB.load(k);
}

function getN(p) {
  const t = p.getTags().find(
    (t) => t.startsWith(TAG)
  );
  return t
    ? clamp(parseInt(t.slice(TAG.length)) || CFG.BASE, CFG.MIN, CFG.MAX)
    : CFG.BASE;
}

function setN(p, n) {
  const v = clamp(n, CFG.MIN, CFG.MAX);

  system.run(
    () => {
      try {
        for (const t of p.getTags()) {
          if (t.startsWith(TAG)) {
            p.removeTag(t);
          }
        }
        p.addTag(TAG + v);
      } catch {}
    }
  );
}

function applyHealthGroup(p, n) {
  const ev = `health${clamp(n, CFG.MIN, CFG.MAX)}`;

  system.run(
    () => {
      try {
        p.triggerEvent?.(ev);
      } catch {}
    }
  );
}

function giveHeartItem(dim, loc, c = 1) {
  system.run(
    () => {
      try {
        dim.spawnItem(new ItemStack(CFG.HEART_ITEM_ID, c), loc);
      } catch {}
    }
  );
}

system.runInterval(
  () => {
    try {
      for (const p of world.getPlayers()) {
        savePos(p);
      }
    } catch {}
  },
  CFG.SAVE_EVERY_TICKS
);

function tpByCommandWithRot(p, pos) {
  try {
    const x = pos.x.toFixed(3);
    const y = pos.y.toFixed(3);
    const z = pos.z.toFixed(3);
    const yaw = (pos.yaw ?? 0).toFixed(2);
    const pitch = (pos.pitch ?? 0).toFixed(2);

    p.runCommand(
      `execute in ${pos.dim} run tp @s ${x} ${y} ${z} ${yaw} ${pitch}`
    );
  } catch {}
}

world.afterEvents.playerSpawn.subscribe(
  (ev) => {
    const { player, initialSpawn } = ev;
    if (!player || player.isSimulated) {
      return;
    }

    system.run(
      () => {
        try {
          if (!player.getTags().some((t) => t.startsWith(TAG))) {
            player.addTag(TAG + CFG.BASE);
          }
          applyHealthGroup(player, getN(player));
        } catch {}
      }
    );

    if (!CFG.ROYAL_MODE) {
      return;
    }

    const key = getKey(player);
    const death = lastDeath.get(key);

    if (!death || initialSpawn) {
      return;
    }

    system.run(
      () => {
        try {
          player.runCommand("gamemode spectator");
        } catch {}
      }
    );

    const job = function* () {
      yield system.waitTicks(5);
      try {
        const pos = getSavedPosByKey(key) ?? death;
        tpByCommandWithRot(player, pos);
      } catch {} finally {
        lastDeath.delete(key);
      }
    };

    system.runJob(
      job()
    );
  }
);

world.afterEvents.itemCompleteUse.subscribe(
  (ev) => {
    const { source: p, itemStack } = ev;

    if (!p || p.typeId !== "minecraft:player") {
      return;
    }
    if (!itemStack || itemStack.typeId !== CFG.HEART_ITEM_ID) {
      return;
    }

    const n = getN(p);
    if (n >= CFG.MAX) {
      return;
    }

    system.run(
      () => {
        setN(p, n + 1);
        applyHealthGroup(p, n + 1);
      }
    );
  }
);

world.afterEvents.entityDie.subscribe(
  (ev) => {
    const dead = ev.deadEntity;
    if (!dead || dead.typeId !== "minecraft:player") {
      return;
    }

    if (CFG.ROYAL_MODE) {
      try {
        const l = dead.location;
        const v = dead.getViewDirection?.() ?? { x: 0, y: 0, z: 1 };
        const { yaw, pitch } = dirToYawPitch(v);

        lastDeath.set(
          getKey(dead),
          { dim: dimId(dead.dimension), x: l.x, y: l.y, z: l.z, yaw, pitch }
        );
      } catch {}
    }

    const killer = ev.damageSource?.damagingEntity;
    if (CFG.DROP_ONLY_ON_PLAYER_KILL && (!killer || killer.typeId !== "minecraft:player")) {
      return;
    }

    const n = getN(dead);
    if (n > CFG.MIN) {
      giveHeartItem(dead.dimension, dead.location, 1);
      setN(dead, n - 1);
      applyHealthGroup(dead, n - 1);
    }
  }
);

world.afterEvents.entityHurt.subscribe(
  (ev) => {
    const p = ev.entity;
    if (!p || p.typeId !== "minecraft:player") {
      return;
    }

    let hp = 0;
    try {
      hp = p.getComponent("minecraft:health").currentValue | 0;
    } catch {}

    const incoming = ev.damage | 0;
    if (hp - incoming > 0) {
      return;
    }

    const n = getN(p);
    if (n <= CFG.MIN) {
      return;
    }

    ev.damage = 0;

    system.run(
      () => {
        setN(p, n - 1);
        applyHealthGroup(p, n - 1);

        try {
          const hc = p.getComponent("minecraft:health");
          hc.setCurrentValue(Math.max(1, CFG.ANTI_LETHAL_HEAL_HP));
        } catch {}
      }
    );
  }
);
