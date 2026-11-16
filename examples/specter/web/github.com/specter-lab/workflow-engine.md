# specter-lab/workflow-engine

Synthetic lab content. This is not a real GitHub repository.

A small durable workflow engine. Each step writes a checkpoint, and a timer is a row in the same store, so a timer survives a restart of the process that set it.

The engine wakes a workflow from its own alarm, not from a process that must stay alive. See the [timer design](https://github.com/specter-lab/details.md) for the restart example.
