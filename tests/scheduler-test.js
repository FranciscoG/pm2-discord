const test = require("tape");
const Scheduler = require("../dist/scheduler.js").default;

test("Scheduled callback runs after 1 second", function (t) {
  t.plan(2);

  const sched = new Scheduler({
    buffer_seconds: 1,
    buffer_max_seconds: 3,
  });

  const start = Date.now();

  sched.schedule(function () {
    const end = Date.now();
    t.equal(end - start >= 1000, true);
    t.equal(end - start < 3000, true);
  });
});

test("rescheduling delays function call", { timeout: 5000 }, function (t) {
  t.plan(2);

  const sched = new Scheduler({
    buffer_seconds: 2,
    buffer_max_seconds: 5,
  });

  const start = Date.now();

  sched.schedule(function () {
    t.fail("this should have been cancelled");
  });

  setTimeout(() => {
    sched.schedule(function () {
      const end = Date.now();
      t.equal(end - start >= 1500, true);
      t.equal(end - start < 5000, true);
    });
  }, 1500);
});

test("When max seconds is reached the function should be called", { timeout: 6000 }, function (t) {
  t.plan(1);

  const sched = new Scheduler({
    buffer_seconds: 1,
    buffer_max_seconds: 5,
  });

  const start = Date.now();

  const interval = setInterval(() => {
    sched.schedule(function () {
      const end = Date.now();
      clearInterval(interval);
      t.equal(end - start >= 4000, true);
    });
  }, 500);
});
